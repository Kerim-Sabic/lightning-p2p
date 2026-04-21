import {
  ArrowDownToLine,
  Clock3,
  Send,
  Settings2,
} from "lucide-react";
import type { View } from "../App";
import { useNavigationSnapshot } from "../stores/transferSelectors";

interface MobileTabBarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const tabItems: Array<{
  id: View;
  label: string;
  icon: typeof Send;
}> = [
  { id: "send", label: "Send", icon: Send },
  { id: "receive", label: "Receive", icon: ArrowDownToLine },
  { id: "history", label: "History", icon: Clock3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function MobileTabBar({ currentView, onNavigate }: MobileTabBarProps) {
  const { receiveTransferCount } = useNavigationSnapshot();

  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      {tabItems.map((item) => {
        const Icon = item.icon;
        const active = currentView === item.id;
        const badge =
          item.id === "receive" && receiveTransferCount > 0
            ? receiveTransferCount
            : null;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`mobile-tab-button ${active ? "mobile-tab-button-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="relative">
              <Icon className="h-[19px] w-[19px]" />
              {badge ? (
                <span className="absolute -right-2 -top-2 min-w-4 rounded-full border border-emerald-300/20 bg-emerald-500 px-1 text-[9px] font-semibold leading-4 text-white">
                  {badge}
                </span>
              ) : null}
            </span>
            <span className="text-[11px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
