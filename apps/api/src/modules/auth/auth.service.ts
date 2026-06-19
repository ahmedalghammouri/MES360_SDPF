import {
  Injectable, UnauthorizedException, BadRequestException, Logger, ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import type { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  enterpriseId: string;
  factoryId: string | null;
  factoryCode: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Validates credentials — factoryCode optional (SUPER_ADMIN can omit or specify any)
  async validateUser(email: string, password: string, factoryCode?: string): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });

    if (!user || !user.isActive) return null;

    // Check account lock
    if (user.lockedAt) {
      const lockDuration = 30 * 60 * 1000; // 30 minutes
      if (new Date().getTime() - user.lockedAt.getTime() < lockDuration) {
        return null;
      }
      // Auto-unlock after 30 min
      await this.prisma.user.update({ where: { id: user.id }, data: { lockedAt: null, failedLoginAttempts: 0 } });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.recordFailedLogin(user.id);
      return null;
    }

    // Factory validation — non-SUPER_ADMIN must belong to the requested factory
    if (factoryCode && user.role !== 'SUPER_ADMIN') {
      const factory = await this.prisma.factory.findUnique({ where: { code: factoryCode.toUpperCase() } });
      if (!factory || user.factoryId !== factory.id) {
        this.logger.warn(`User ${email} attempted login to factory ${factoryCode} but is assigned elsewhere`);
        return null;
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lastLoginAt: new Date() },
    });

    return user;
  }

  async login(
    user: User,
    factoryCode?: string,
  ): Promise<{ user: object; accessToken: string; refreshToken: string }> {
    // Determine effective factory for this session
    let effectiveFactoryId: string | null = user.factoryId;
    let effectiveFactoryCode: string | null = null;

    if (factoryCode) {
      const factory = await this.prisma.factory.findUnique({ where: { code: factoryCode.toUpperCase() } });
      if (factory) {
        effectiveFactoryId = factory.id;
        effectiveFactoryCode = factory.code;
      }
    } else if (user.factoryId) {
      const factory = await this.prisma.factory.findUnique({ where: { id: user.factoryId } });
      effectiveFactoryCode = factory?.code ?? null;
    }

    // SUPER_ADMIN without factoryCode → no factory context (sees enterprise dashboard)
    if (user.role === 'SUPER_ADMIN' && !effectiveFactoryCode) {
      effectiveFactoryId = null;
    }

    const tokens = await this.generateTokens(user, effectiveFactoryId, effectiveFactoryCode);
    await this.createSession(user.id, tokens.refreshToken, effectiveFactoryId);

    this.logger.log(`User ${user.email} logged in (factory: ${effectiveFactoryCode ?? 'all'})`);

    // Return enriched user profile with factory info
    const userWithFactory = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { factory: true, enterprise: true },
    });

    return {
      user: this.sanitizeUser(userWithFactory!),
      ...tokens,
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens & { user: object }> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('jwt.refreshSecret'),
      });

      const sessions = await this.prisma.userSession.findMany({
        where: { userId: payload.sub, expiresAt: { gt: new Date() }, isRevoked: false },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Verify token hash against stored sessions
      let validSession: typeof sessions[0] | null = null;
      for (const session of sessions) {
        const match = await bcrypt.compare(refreshToken, session.refreshToken);
        if (match) { validSession = session; break; }
      }

      if (!validSession) throw new UnauthorizedException('Invalid or expired refresh token');

      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: payload.sub },
        include: { factory: true, enterprise: true },
      });

      const tokens = await this.generateTokens(user, payload.factoryId, payload.factoryCode);

      // Rotate refresh token
      await this.prisma.userSession.update({
        where: { id: validSession.id },
        data: {
          refreshToken: await bcrypt.hash(tokens.refreshToken, 6),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      return { user: this.sanitizeUser(user), ...tokens };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
    this.logger.log(`User ${userId} logged out`);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) throw new BadRequestException('Current password is incorrect');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, passwordChangedAt: new Date() },
    });

    await this.prisma.userSession.updateMany({ where: { userId }, data: { isRevoked: true } });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null, isActive: true },
    });

    // Always return success to prevent user enumeration attacks
    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpiry: expiry,
      },
    });

    const baseUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    this.logger.log(`Password reset requested for ${email}, reset URL generated`);

    // Import lazily to avoid circular dep — notifications service sends the email
    this.eventEmitter.emit('auth.password-reset.requested', {
      email: user.email,
      name: user.name,
      resetToken,
      resetUrl,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpiry: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiry: null,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedAt: null,
      },
    });

    // Revoke all sessions for security
    await this.prisma.userSession.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true },
    });

    this.logger.log(`Password reset completed for user ${user.email}`);
  }

  // Returns list of factories available for login (for factory selector population)
  async getFactoriesForSelector(): Promise<Array<{
    id: string; code: string; name: string; nameAr: string | null;
    city: string | null; lat: number | null; lng: number | null;
    color: string; glowColor: string; isActive: boolean;
  }>> {
    return this.prisma.factory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameAr: true, city: true, lat: true, lng: true, color: true, glowColor: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Public landing-page overview: every active factory with REAL KPIs
   * (OEE/availability/performance/quality averaged from oee_records,
   * employee headcount, active-alarm count, shifts started today, today's
   * output) plus a network-wide summary. Powers the factory-selector map
   * and the login marketing panel with live data instead of static numbers.
   */
  async getFactoriesOverview() {
    const factories = await this.prisma.factory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, nameAr: true, city: true, lat: true, lng: true, color: true, glowColor: true, isActive: true },
      orderBy: { code: 'asc' },
    });
    const ids = factories.map((f) => f.id);
    if (ids.length === 0) {
      return { factories: [], summary: { avgOEE: 0, avgQuality: 0, totalFactories: 0, totalEmployees: 0, totalActiveAlarms: 0 } };
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [oeeAll, oeeToday, employees, alarms, shifts] = await Promise.all([
      // OEE quality metrics averaged over all records (stable snapshot)
      this.prisma.oEERecord.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids } },
        _avg: { oee: true, availability: true, performance: true, quality: true },
      }),
      // Today's output for the production figure
      this.prisma.oEERecord.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, recordDate: { gte: dayStart } },
        _sum: { totalOutput: true },
      }),
      this.prisma.user.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, isActive: true, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.alarmEvent.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, resolvedAt: null },
        _count: { _all: true },
      }),
      this.prisma.shiftInstance.groupBy({
        by: ['factoryId'],
        where: { factoryId: { in: ids }, startTime: { gte: dayStart } },
        _count: { _all: true },
      }),
    ]);

    const round1 = (n: number | null | undefined) => Math.round((n ?? 0) * 10) / 10;
    const oeeMap = new Map(oeeAll.map((r) => [r.factoryId, r._avg]));
    const prodMap = new Map(oeeToday.map((r) => [r.factoryId, r._sum.totalOutput ?? 0]));
    const empMap = new Map(employees.map((r) => [r.factoryId, r._count._all]));
    const alarmMap = new Map(alarms.map((r) => [r.factoryId, r._count._all]));
    const shiftMap = new Map(shifts.map((r) => [r.factoryId, r._count._all]));

    const enriched = factories.map((f) => {
      const o = oeeMap.get(f.id);
      const availability = round1(o?.availability);
      return {
        ...f,
        kpis: {
          oee: round1(o?.oee),
          availability,
          performance: round1(o?.performance),
          quality: round1(o?.quality),
          uptime: availability, // availability is the real uptime proxy
          production: prodMap.get(f.id) ?? 0,
          employees: empMap.get(f.id) ?? 0,
          activeAlarms: alarmMap.get(f.id) ?? 0,
          shiftsToday: shiftMap.get(f.id) ?? 0,
        },
      };
    });

    const withOEE = enriched.filter((f) => f.kpis.oee > 0);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);

    return {
      factories: enriched,
      summary: {
        avgOEE: round1(avg(withOEE.map((f) => f.kpis.oee))),
        avgQuality: round1(avg(withOEE.map((f) => f.kpis.quality))),
        totalFactories: factories.length,
        totalEmployees: enriched.reduce((s, f) => s + f.kpis.employees, 0),
        totalActiveAlarms: enriched.reduce((s, f) => s + f.kpis.activeAlarms, 0),
      },
    };
  }

  private async generateTokens(
    user: User,
    factoryId: string | null,
    factoryCode: string | null,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      enterpriseId: user.enterpriseId,
      factoryId,
      factoryCode,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? this.config.get<string>('jwt.expiresIn') ?? '8h',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? this.config.get<string>('jwt.refreshExpiresIn') ?? '30d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async createSession(userId: string, refreshToken: string, factoryId?: string | null): Promise<void> {
    const hashedToken = await bcrypt.hash(refreshToken, 6);
    await this.prisma.userSession.create({
      data: {
        userId,
        refreshToken: hashedToken,
        factoryId: factoryId ?? null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Clean expired / revoked sessions
    await this.prisma.userSession.deleteMany({
      where: {
        userId,
        OR: [{ expiresAt: { lt: new Date() } }, { isRevoked: true }],
      },
    });
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= 5) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedAt: new Date() },
      });
      this.logger.warn(`Account locked for user ${userId} after 5 failed attempts`);
    }
  }

  sanitizeUser(user: any) {
    const { passwordHash, mfaSecret, ...safeUser } = user;
    return safeUser;
  }
}
