import type { Metadata } from 'next';
import { ShopFloorView } from '@/features/shop-floor/shop-floor-view';

export const metadata: Metadata = { title: 'Shop Floor | Operation Hub' };

export default function HubShopFloorPage() {
  return <ShopFloorView />;
}
