import {
  ShoppingBag,
  Ticket,
  BadgeCheck,
  Boxes,
  ChartColumn,
  FileText,
  Folder,
  Gauge,
  Globe,
  History,
  Package,
  Receipt,
  Settings,
  Shield,
  Smartphone,
  Store,
  Tags,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  store: Store,
  gauge: Gauge,
  receipt: Receipt,
  "badge-check": BadgeCheck,
  wallet: Wallet,
  "file-text": FileText,
  users: Users,
  globe: Globe,
  package: Package,
  folder: Folder,
  tags: Tags,
  upload: Upload,
  boxes: Boxes,
  chart: ChartColumn,
  shield: Shield,
  smartphone: Smartphone,
  settings: Settings,
  history: History,
  "shopping-bag": ShoppingBag,
  ticket: Ticket,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Gauge;
  return <Icon className={className} aria-hidden />;
}
