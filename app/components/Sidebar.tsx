"use client";
import { BarChart3, ListChecks, History, Bitcoin } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const items = [
    { id: 'chart', label: 'Chart View', icon: <BarChart3 size={18} /> },
    { id: 'strategy', label: 'EMA Strategy', icon: <ListChecks size={18} /> },
    { id: 'history', label: 'Trade History', icon: <History size={18} /> },
    { id: 'backtest', label: 'Backtesting', icon: <BarChart3 size={18} /> },
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <Bitcoin size={20} />
        </div>
        <div className="sidebar-brand-text">
          <h2>EMABOT</h2>
          <span>BTC Spot Strategy</span>
        </div>
      </div>
      
      <ul className="sidebar-list">
        {items.map(item => (
          <li key={item.id} className="sidebar-item">
            <button
              className={`sidebar-link ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => onTabChange(item.id)}
              type="button"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
