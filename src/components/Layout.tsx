import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  LayoutDashboard,
  Compass,
  FolderOpen,
  MapPin,
  BarChart3,
  ShieldAlert,
  OctagonAlert,
  Menu,
  X
} from 'lucide-react';
import { sendRoverCommand } from '../lib/api';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [estopTriggered, setEstopTriggered] = useState(false);

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/planner', label: 'Mission Planner', icon: Compass },
    { path: '/library', label: 'Mission Hub', icon: FolderOpen },
    { path: '/teleop', label: 'Manual & E-Stop', icon: ShieldAlert },
    { path: '/fields', label: 'Fields', icon: MapPin },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  ];

  async function handleQuickEStop() {
    setEstopTriggered(true);
    await sendRoverCommand('estop');
    navigate('/teleop');
    setTimeout(() => setEstopTriggered(false), 2000);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col font-sans">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="flex items-center gap-2.5 group">
                <div className="w-9 h-9 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-all">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                    Rover Mission Manager
                  </h1>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">
                    Autonomous AgTech Telemetry
                  </p>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex md:items-center md:space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700/60'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {/* Quick E-Stop Trigger */}
              <div className="pl-2">
                <button
                  onClick={handleQuickEStop}
                  className={`bg-red-600 hover:bg-red-700 text-white text-xs font-black px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm active:scale-95 transition-all uppercase tracking-wider ${
                    estopTriggered ? 'animate-ping' : ''
                  }`}
                  title="Immediate Remote Safety Emergency Stop"
                >
                  <OctagonAlert className="w-3.5 h-3.5" />
                  <span>E-Stop</span>
                </button>
              </div>
            </div>

            {/* Mobile menu button */}
            <div className="flex items-center gap-2 md:hidden">
              <button
                onClick={handleQuickEStop}
                className="bg-red-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1 uppercase"
              >
                <OctagonAlert className="w-3.5 h-3.5" />
                <span>E-Stop</span>
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-hidden"
                aria-label="Toggle Menu"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 pt-2 pb-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-semibold'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
