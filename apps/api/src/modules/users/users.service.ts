import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(factoryId: string | null, filters: {
    search?: string; role?: string; page?: number; limit?: number;
  }) {
    const { search, role, page = 1, limit = 20 } = filters;

    const where: any = {
      deletedAt: null,
      ...(factoryId && { factoryId }),
      ...(role && { role }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true,
          department: true, jobTitle: true, phone: true,
          isActive: true, lastLoginAt: true, createdAt: true,
          avatarUrl: true, factoryId: true,
          factory: { select: { code: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        factory: { select: { id: true, code: true, name: true, color: true } },
        enterprise: { select: { id: true, code: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, mfaSecret, ...safe } = user;
    return safe;
  }

  async create(data: {
    enterpriseId: string;
    factoryId?: string | null;
    email: string;
    name: string;
    role: string;
    department?: string;
    jobTitle?: string;
    phone?: string;
    password: string;
  }) {
    const exists = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await this.prisma.user.create({
      data: {
        enterpriseId: data.enterpriseId,
        factoryId: data.factoryId ?? null,
        email: data.email.toLowerCase(),
        name: data.name,
        role: data.role as any,
        department: data.department,
        jobTitle: data.jobTitle,
        phone: data.phone,
        passwordHash,
      },
    });
    const { passwordHash: _, mfaSecret, ...safe } = user;
    return safe;
  }

  async update(id: string, data: {
    name?: string; role?: string; department?: string;
    jobTitle?: string; phone?: string; isActive?: boolean; factoryId?: string | null;
  }) {
    const user = await this.prisma.user.update({ where: { id }, data: data as any });
    const { passwordHash, mfaSecret, ...safe } = user;
    return safe;
  }

  /** Self-service profile update — only safe, user-owned fields (never role/isActive/factory). */
  async updateProfile(id: string, data: {
    name?: string; nameAr?: string; department?: string; jobTitle?: string;
    phone?: string; language?: string; timezone?: string;
    notifyEmail?: boolean; notifyWhatsapp?: boolean; notifySMS?: boolean;
  }) {
    const allowed: any = {};
    for (const key of ['name', 'nameAr', 'department', 'jobTitle', 'phone', 'language', 'timezone', 'notifyEmail', 'notifyWhatsapp', 'notifySMS'] as const) {
      if (data[key] !== undefined) allowed[key] = data[key];
    }
    const user = await this.prisma.user.update({ where: { id }, data: allowed });
    const { passwordHash, mfaSecret, ...safe } = user;
    return safe;
  }

  async deactivate(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }
}
