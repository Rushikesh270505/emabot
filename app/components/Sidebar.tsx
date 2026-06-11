import Link from 'next/link';
import { useRouter } from 'next/router';
import { BarChart3, Key, ListChecks, History } from 'lucide-react';
import { ReactNode } from 'react';

type Tab = {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
};

const TABS: Tab[] = [
  { id: 'chart', label: 'Chart', icon: <BarChart3 size={16} />, href: '/' },
  { id: 'strategy', label: 'Strategy', icon: <ListChecks size={16} />, href: '/' },
  { id: 'history', label: 'History', icon: <History size={16} />, href: '/' },
  { id: 'apis', label: 'APIs', icon: <Key size={16} />, href: '/' }
];

export function Sidebar() {
  const router = useRouter();
  const currentPath = router.pathname;

  return (
    <nav className="sidebar">
      <ul className="sidebar-list">
        {TABS.map((tab) => (
          <li key={tab.id} className="sidebar-item">
            <Link href={tab.href} className={`sidebar-link ${router.asPath.includes(tab.id) ? 'active' : ''}`}> 
              {tab.icon}
              <span>{tab.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
