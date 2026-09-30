import { Clock3, MessageCircle, Radar, Send, Settings2 } from "lucide-react";
import type { View } from "../App";

interface MobileTabBarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const tabItems: Array<{
  id: View;
  label: string;
  icon: typeof Send;
}> = [
  { id: "send", label: "Transfer", icon: Send },
  { id: "devices", label: "Devices", icon: Radar },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "history", label: "Activity", icon: Clock3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

export function MobileTabBar({ currentView, onNavigate }: MobileTabBarProps) {
  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      {tabItems.map((item) => {
        const Icon = item.icon;
        const active = currentView === item.id;
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
            </span>
            <span className="text-[11px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
