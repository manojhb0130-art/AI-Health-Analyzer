/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  BarChart3, 
  Bell, 
  Calendar, 
  ChevronRight, 
  Database, 
  FileText, 
  Home, 
  Info, 
  LayoutDashboard, 
  LogOut, 
  RefreshCcw, 
  Settings, 
  TrendingUp, 
  Upload, 
  User, 
  Zap,
  Navigation,
  Crosshair,
  ShieldAlert
} from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  BarChart,
  Bar,
  Cell,
  ComposedChart
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { format, subDays, parseISO } from 'date-fns';
import { cn } from './lib/utils';

// --- Types ---
type View = 'dashboard' | 'alerts' | 'explain' | 'forecast' | 'ingest' | 'login' | 'forgot' | 'reset' | 'users' | 'sentinel';

interface TimeseriesData {
  date: string;
  carbon_footprint: number;
  energy_consumption: number;
  water_usage: number;
  waste_generated: number;
  air_quality_index: number;
  renewable_energy_pct: number;
  supply_chain_emissions: number;
  soil_health_index: number;
  is_violation: number;
}

interface Alert {
  id: number;
  date: string;
  risk_score: number;
  severity: 'CRITICAL' | 'WARNING' | 'LOW';
  message: string;
  resolved: boolean;
}

// --- API Helper ---
const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('radar_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const MAPS_API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-lg group",
      active 
        ? "bg-blue-600/10 text-blue-400 border border-blue-600/20" 
        : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
    )}
    id={`sidebar-item-${label.toLowerCase().replace(' ', '-')}`}
  >
    <Icon className={cn("w-5 h-5", active ? "text-blue-400" : "text-zinc-500 group-hover:text-zinc-300")} />
    {label}
  </button>
);

const MetricCard = ({ title, value, subValue, trend, icon: Icon, color }: { title: string, value: string | number, subValue?: string, trend?: 'up' | 'down', icon: any, color: string }) => (
  <div className="p-5 border bg-zinc-900 border-zinc-800 rounded-xl" id={`metric-${title.toLowerCase().replace(' ', '-')}`}>
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</p>
        <h3 className="mt-1 text-2xl font-semibold text-zinc-100">{value}</h3>
        {subValue && (
          <p className={cn("mt-1 text-xs", trend === 'up' ? "text-red-400" : "text-emerald-400")}>
            {subValue}
          </p>
        )}
      </div>
      <div className={cn("p-2 rounded-lg", color)}>
        <Icon className="w-5 h-5 text-white" />
      </div>
    </div>
  </div>
);

// --- Main App ---

export default function App() {
  const [view, setView] = useState<View>('login');
  const [data, setData] = useState<TimeseriesData[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [explainData, setExplainData] = useState<any>(null);
  const [forecastData, setForecastData] = useState<any[]>([]);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [notification, setNotification] = useState<Alert | null>(null);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [envAnalysis, setEnvAnalysis] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('radar_token');
    const storedUser = localStorage.getItem('radar_user');
    if (token && storedUser) {
      setUser(JSON.parse(storedUser));
      setView('dashboard');
      fetchDashboard();
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'new_alert') {
        const newAlert = message.data;
        setAlerts((prev) => [newAlert, ...prev]);
        setNotification(newAlert);
        // Auto-hide notification after 8 seconds
        setTimeout(() => setNotification(null), 8000);
      }
    };

    return () => socket.close();
  }, [user]);

  useEffect(() => {
    if (view === 'sentinel' && !location) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.error("Location Access Denied")
      );
    }
  }, [view]);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dashboard');
      setData(res.data.data);
      setAlerts(res.data.alerts);
      setMetrics(res.data.metrics);
      
      // If admin, also fetch users if in that view or just to pre-cache
      const storedUser = localStorage.getItem('radar_user');
      if (storedUser && JSON.parse(storedUser).role === 'admin') {
        fetchUsers();
      }

      setLoading(false);
    } catch (err) {
      console.error(err);
      handleLogout();
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsersList(res.data);
    } catch (err) {
      console.error("Failed to fetch users");
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    try {
      setLoading(true);
      const res = await api.post('/login', { username, password });
      localStorage.setItem('radar_token', res.data.token);
      localStorage.setItem('radar_user', JSON.stringify({ username: res.data.username, role: res.data.role }));
      setUser({ username: res.data.username, role: res.data.role });
      setView('dashboard');
      fetchDashboard();
    } catch (err: any) {
      alert(err.response?.data?.message || "Invalid login credentials");
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    try {
      setLoading(true);
      const res = await api.post('/forgot-password', { email });
      alert(res.data.message);
      setView('reset');
    } catch (err: any) {
      alert(err.response?.data?.message || "Error sending reset token");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const token = formData.get('token') as string;
    const newPassword = formData.get('newPassword') as string;
    try {
      setLoading(true);
      const res = await api.post('/reset-password', { email, token, newPassword });
      alert(res.data.message);
      setView('login');
    } catch (err: any) {
      alert(err.response?.data?.message || "Error resetting password");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('radar_token');
    localStorage.removeItem('radar_user');
    setUser(null);
    setView('login');
  };

  if (view === 'login') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 border bg-zinc-900 border-zinc-800 rounded-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Zap className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">EcoSphere</h1>
          </div>
          
          <h2 className="text-xl font-semibold mb-2">Welcome Back</h2>
          <p className="text-zinc-400 text-sm mb-6">Enter your credentials to access the enterprise sustainability platform.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">Username</label>
              <input 
                name="username"
                type="text" 
                placeholder="e.g., admin or analyst"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">Password</label>
              <input 
                name="password"
                type="password" 
                placeholder="••••••••"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors mt-4 shadow-lg shadow-blue-600/20"
            >
              Sign In
            </button>
            <div className="flex items-center justify-center mt-4">
              <button 
                type="button" 
                onClick={() => setView('forgot')}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                id="forgot-password-link"
              >
                Forgot your password?
              </button>
            </div>
            <div className="pt-4 text-center">
               <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Demo Access</p>
               <p className="text-[10px] text-zinc-500 font-mono mt-1">admin / admin123 • analyst / analyst123</p>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  if (view === 'forgot') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 border bg-zinc-900 border-zinc-800 rounded-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Zap className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">EcoSphere</h1>
          </div>
          
          <h2 className="text-xl font-semibold mb-2">Forgot Password</h2>
          <p className="text-zinc-400 text-sm mb-6">Enter your email and we'll send you a recovery token.</p>
          
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">Email Address</label>
              <input 
                name="email"
                type="email" 
                placeholder="admin@ecosphere.com"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors mt-4 shadow-lg shadow-blue-600/20"
            >
              Send Reset Token
            </button>
            <div className="flex items-center justify-center mt-4">
              <button 
                type="button" 
                onClick={() => setView('login')}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Back to Login
              </button>
            </div>
            <div className="pt-4 text-center">
               <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Demo Note</p>
               <p className="text-[10px] text-zinc-500 mt-1 italic">Check server console logs for the generated token.</p>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  if (view === 'reset') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 border bg-zinc-900 border-zinc-800 rounded-2xl"
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Zap className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">EcoSphere</h1>
          </div>
          
          <h2 className="text-xl font-semibold mb-2">Reset Password</h2>
          <p className="text-zinc-400 text-sm mb-6">Enter the token sent to your email and your new password.</p>
          
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">Email</label>
              <input 
                name="email"
                type="email" 
                placeholder="admin@ecosphere.com"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">Reset Token</label>
              <input 
                name="token"
                type="text" 
                placeholder="8-CHARACTER-TOKEN"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono uppercase"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase text-zinc-500 mb-1">New Password</label>
              <input 
                name="newPassword"
                type="password" 
                placeholder="••••••••"
                className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors mt-4 shadow-lg shadow-blue-600/20"
            >
              Update Password
            </button>
            <div className="flex items-center justify-center mt-4">
              <button 
                type="button" 
                onClick={() => setView('login')}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Back to Login
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-black text-zinc-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 p-6 flex flex-col hidden md:flex">
        <div className="flex items-center gap-3 mb-10">
          <div className="p-1.5 bg-blue-600 rounded-md">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">EcoSphere</span>
        </div>

        <nav className="space-y-2 flex-1">
          <SidebarItem icon={Home} label="ESG Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <SidebarItem icon={Bell} label="Environmental Alerts" active={view === 'alerts'} onClick={() => setView('alerts')} />
          <SidebarItem icon={Activity} label="AI Insights & Efficiency" active={view === 'explain'} onClick={() => setView('explain')} />
          <SidebarItem icon={TrendingUp} label="Climate Resilience Planning" active={view === 'forecast'} onClick={() => setView('forecast')} />
          <SidebarItem icon={Database} label="IoT Data Hub" active={view === 'ingest'} onClick={() => setView('ingest')} />
          <SidebarItem icon={Navigation} label="Global Environmental Monitor" active={view === 'sentinel'} onClick={() => setView('sentinel')} />
          {user?.role === 'admin' && (
            <SidebarItem icon={Settings} label="User Management" active={view === 'users'} onClick={() => { setView('users'); fetchUsers(); }} />
          )}
        </nav>

        <div className="pt-6 border-t border-zinc-800">
            <div className="flex items-center gap-3 px-4">
               <div className="h-8 w-8 rounded-full bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
                 <User className="w-4 h-4 text-blue-400" />
               </div>
               <div className="flex flex-col">
                 <span className="text-xs font-medium text-zinc-200">{user?.username}</span>
                 <span className="text-[10px] text-zinc-500 uppercase tracking-tighter">{user?.role}</span>
               </div>
            </div>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2 text-sm text-zinc-500 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 sticky top-0 bg-black/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
              {view === 'dashboard' ? 'ESG Sustainability Dashboard' : view.toUpperCase()}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-zinc-400 hover:text-white transition-colors relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-black"></span>
            </button>
            <div className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <User className="w-4 h-4 text-zinc-400" />
            </div>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-8"
              >
                {/* Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <MetricCard 
                    title="Current Risk Score" 
                    value={`${metrics?.avgRisk || 0}%`} 
                    subValue={metrics?.avgRisk > 70 ? "+12% vs last week" : "-3% vs last week"}
                    trend={metrics?.avgRisk > 70 ? 'up' : 'down'}
                    icon={Activity} 
                    color={metrics?.avgRisk > 70 ? "bg-red-600" : metrics?.avgRisk > 40 ? "bg-yellow-600" : "bg-emerald-600"} 
                  />
                  <MetricCard 
                    title="Weekly Carbon Footprint"
                    value={`${Math.round(metrics?.totalCarbon7d || 0)} tons`}
                    subValue="+8% vs avg"
                    trend="up"
                    icon={TrendingUp} 
                    color="bg-blue-600" 
                  />
                  <MetricCard 
                    title="Active Alerts" 
                    value={metrics?.alertsToday || 0} 
                    subValue="High priority"
                    icon={AlertTriangle} 
                    color="bg-red-500" 
                  />
                  <MetricCard 
                    title="Avg Lead Time" 
                    value={metrics?.leadTimeMs || "4.2d"} 
                    subValue="Early warning"
                    icon={Zap} 
                    color="bg-zinc-700" 
                  />
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 border border-zinc-800 bg-zinc-900/50 rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold">Carbon Footprint Trend (90 Days)</h3>
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span> Reported Emissions
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                          <span className="w-2 h-2 rounded-full bg-zinc-500 border border-zinc-400"></span> Prediction
                        </span>
                      </div>
                    </div>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#52525b" 
                            fontSize={10} 
                            tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                          />
                          <YAxis stroke="#52525b" fontSize={10} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            itemStyle={{ color: '#f4f4f5' }}
                          />
                          <Area type="monotone" dataKey="carbon_footprint" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCases)" />
                          <Line type="monotone" dataKey="carbon_footprint" stroke="#60a5fa" strokeWidth={2} dot={false} />
                          <defs>
                            <linearGradient id="colorCases" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="border border-zinc-800 bg-zinc-900/50 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-6 text-zinc-100">Recent Signals</h3>
                    <div className="space-y-4 overflow-auto max-h-[300px]">
                      {alerts.map((alert) => (
                        <div key={alert.id} className="p-4 rounded-xl border border-zinc-800 bg-black hover:bg-zinc-800/50 transition-colors cursor-pointer group">
                          <div className="flex items-start justify-between mb-2">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                              alert.severity === 'CRITICAL' ? "bg-red-500/10 text-red-500 border border-red-500/20" : "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                            )}>
                              {alert.severity}
                            </span>
                            <span className="text-[10px] text-zinc-500">{alert.date}</span>
                          </div>
                          <p className="text-sm text-zinc-300 line-clamp-2 leading-relaxed">{alert.message}</p>
                          <div className="mt-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] text-blue-400 font-medium flex items-center gap-1">
                              Analyze Explainer <ChevronRight className="w-3 h-3" />
                            </span>
                            <span className="text-[10px] text-zinc-500">{alert.risk_score}% Probability</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Secondary Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="border border-zinc-800 bg-zinc-900/50 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-6">Energy Consumption & Efficiency</h3>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#52525b" 
                            fontSize={10} 
                            tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                          />
                          <YAxis stroke="#52525b" fontSize={10} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                          />
                          <Area type="monotone" dataKey="energy_consumption" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="border border-zinc-800 bg-zinc-900/50 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-6">Resource Usage & Air Quality</h3>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#52525b" 
                            fontSize={10} 
                            tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                          />
                          <YAxis stroke="#52525b" fontSize={10} />
                          <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }} />
                          <Line type="monotone" dataKey="water_usage" stroke="#ec4899" dot={false} />
                          <Line type="monotone" dataKey="air_quality_index" stroke="#f97316" dot={false} />
                          <Line type="monotone" dataKey="renewable_energy_pct" stroke="#22c55e" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'explain' && (
              <motion.div
                key="explain"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1 space-y-6">
                    <div className="border border-zinc-800 bg-zinc-900 rounded-2xl p-8">
                      <h2 className="text-2xl font-bold mb-4">AI Explainability Layer</h2>
                      <p className="text-zinc-400 mb-8 max-w-2xl">
                        Select a specific date to reveal the underlying model contributions. 
                        Our system decomposes the risk score using SHAP values and natural language synthesis.
                      </p>
                      
                      <div className="flex flex-wrap gap-4 mb-8">
                        {data.slice(-7).map(d => (
                          <button
                            key={d.date}
                            onClick={() => {
                              setSelectedDate(d.date);
                              // Trigger AI explain
                              setLoading(true);
                              api.get(`/explain/${d.date}`).then(res => {
                                setExplainData(res.data);
                                setLoading(false);
                              });
                            }}
                            className={cn(
                              "px-4 py-2 rounded-lg border text-sm transition-all",
                              selectedDate === d.date 
                                ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20" 
                                : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500"
                            )}
                          >
                            {format(parseISO(d.date), 'MMM d')}
                          </button>
                        ))}
                      </div>

                      {explainData ? (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                          <div className="p-6 bg-blue-600/5 border border-blue-600/20 rounded-xl">
                            <div className="flex items-start gap-4">
                              <Info className="w-5 h-5 text-blue-400 mt-1 shrink-0" />
                              <p className="text-zinc-200 leading-relaxed italic">"{explainData.summary}"</p>
                            </div>
                          </div>

                          <div className="h-[300px]">
                            <h4 className="text-sm font-semibold uppercase tracking-widest text-zinc-500 mb-6 flex items-center gap-2">
                              <BarChart3 className="w-4 h-4" /> Feature Attribution (%)
                            </h4>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart layout="vertical" data={explainData.contributions}>
                                <XAxis type="number" hide />
                                <YAxis dataKey="feature" type="category" stroke="#a1a1aa" fontSize={11} width={120} />
                                <Tooltip 
                                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a' }}
                                />
                                <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
                                  {explainData.contributions.map((entry: any, index: number) => (
                                    <Cell key={`cell-${index}`} fill={entry.impact === 'positive' ? '#ef4444' : '#10b981'} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                          <Activity className="w-12 h-12 mb-4 opacity-20" />
                          <p>Select an observation date to view AI explanation</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-full md:w-80 space-y-6">
                    <div className="p-6 border border-zinc-800 bg-zinc-900 rounded-2xl">
                      <h4 className="text-sm font-semibold mb-4">Sustainability Action Simulator</h4>
                      <p className="text-xs text-zinc-500 mb-6">Adjust key metrics to see the simulated risk impact.</p>
                      
                      {['Energy Usage', 'Supply Chain Emissions', 'Waste Generated'].map(label => (
                        <div key={label} className="space-y-2 mb-6">
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">{label}</span>
                            <span className="text-zinc-200 font-mono">+0%</span>
                          </div>
                          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="w-1/2 h-full bg-blue-600"></div>
                          </div>
                        </div>
                      ))}
                      
                      <button className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors mt-4">
                        Recalculate Probability
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'forecast' && (
              <motion.div
                key="forecast"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8"
              >
                 <div className="border border-zinc-800 bg-zinc-900 rounded-2xl p-8">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-bold">Carbon Footprint & Emissions Forecast</h2>
                      <p className="text-zinc-400">14-day forward projection (Confidence Interval 95%)</p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => {
                          setLoading(true);
                          api.get('/forecast/14').then(res => {
                            setForecastData(res.data);
                            setLoading(false);
                          });
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                      >
                        <RefreshCcw className="w-4 h-4" /> Run Simulation
                      </button>
                    </div>
                  </div>

                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[...data.slice(-14), ...forecastData]}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a" />
                        <XAxis 
                          dataKey="date" 
                          stroke="#52525b" 
                          fontSize={10} 
                          tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                        />
                        <YAxis stroke="#52525b" fontSize={10} />
                        <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a' }} />
                        <Area type="monotone" dataKey="carbon_footprint" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} />
                        <Area type="monotone" dataKey="predicted_carbon" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.3} strokeDasharray="5 5" />
                        <Area type="monotone" dataKey="confidence_upper" stroke="none" fill="#3b82f6" fillOpacity={0.05} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-8 p-6 bg-zinc-800/50 rounded-xl flex items-center gap-6">
                    <div className="p-3 bg-blue-500/10 rounded-full border border-blue-500/20">
                      <Calendar className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Peak Prediction Window</p>
                      <p className="text-xs text-zinc-500 mt-1">Our models predict a 65% probability of exceeding the carbon budget threshold between June 12-15 based on current energy trends.</p>
                    </div>
                  </div>
                 </div>
              </motion.div>
            )}

            {view === 'alerts' && (
               <motion.div
                key="alerts"
                className="space-y-6"
               >
                 <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold">Alert Registry</h2>
                    <div className="flex gap-2">
                       <button className="px-4 py-2 border border-zinc-800 hover:bg-zinc-800 rounded-lg text-xs flex items-center gap-2">
                         <FileText className="w-4 h-4" /> Export CSV
                       </button>
                    </div>
                 </div>
                 
                 <div className="border border-zinc-800 bg-zinc-900 rounded-2xl overflow-hidden">
                   <table className="w-full text-left">
                     <thead>
                       <tr className="bg-black/50 border-b border-zinc-800">
                         <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Date</th>
                         <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Severity</th>
                         <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Risk Score</th>
                         <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Alert Message</th>
                         <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Phase</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-zinc-800">
                        {alerts.map((alert) => (
                          <tr key={alert.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-4 text-xs font-mono text-zinc-400">{alert.date}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold",
                                alert.severity === 'CRITICAL' ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-500"
                              )}>
                                {alert.severity}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm font-semibold">{alert.risk_score}%</td>
                            <td className="px-6 py-4 text-sm text-zinc-300 max-w-sm truncate">{alert.message}</td>
                            <td className="px-6 py-4 text-xs text-zinc-500">Early Warning</td>
                          </tr>
                        ))}
                     </tbody>
                   </table>
                 </div>
               </motion.div>
            )}

            {view === 'ingest' && (
               <motion.div
                key="ingest"
                className="max-w-4xl mx-auto space-y-8"
               >
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="p-8 border border-zinc-800 bg-zinc-900 rounded-2xl space-y-6">
                     <h3 className="text-xl font-bold">Manual Data Upload</h3>
                     <p className="text-zinc-400 text-sm">Upload standardized CSV exports from environmental sensors and IoT nodes.</p>
                     
                     <div className="border-2 border-dashed border-zinc-800 rounded-xl p-10 flex flex-col items-center justify-center text-zinc-600 hover:border-blue-600/50 hover:bg-blue-600/5 transition-all cursor-pointer">
                        <Upload className="w-10 h-10 mb-4" />
                        <span className="text-sm font-medium text-zinc-400">Drag files here or click to browse</span>
                        <span className="text-xs mt-2">Maximum file size: 50MB (.csv, .xlsx)</span>
                     </div>
                     
                     <div className="pt-4 space-y-3">
                        {['energy_grid_v2.csv', 'env_monitoring.csv'].map(f => (
                          <div key={f} className="flex items-center justify-between p-3 bg-black rounded-lg border border-zinc-800">
                             <div className="flex items-center gap-3">
                               <FileText className="w-4 h-4 text-zinc-500" />
                               <span className="text-xs text-zinc-300">{f}</span>
                             </div>
                             <span className="text-[10px] text-zinc-500 underline cursor-pointer">Remove</span>
                          </div>
                        ))}
                     </div>
                   </div>

                   <div className="space-y-6">
                      <div className="p-6 border border-zinc-800 bg-zinc-900 rounded-2xl">
                        <h4 className="text-sm font-semibold mb-4">Pipeline Health</h4>
                        <div className="space-y-4">
                           {[
                             { name: 'Environmental Data', status: 'Online', time: '5m' },
                             { name: 'Energy Grids (IoT)', status: 'Online', time: '12m' },
                             { name: 'Supply Chain Scraper', status: 'Online', time: '1m' },
                             { name: 'Waste Management Systems', status: 'Syncing', time: '4h' }
                           ].map(pipe => (
                             <div key={pipe.name} className="flex items-center justify-between">
                               <span className="text-xs text-zinc-400">{pipe.name}</span>
                               <div className="flex items-center gap-3">
                                 <span className="text-[10px] text-zinc-500 italic">Last sync {pipe.time} ago</span>
                                 <span className={cn(
                                   "w-2 h-2 rounded-full",
                                   pipe.status === 'Online' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-yellow-500"
                                 )}></span>
                               </div>
                             </div>
                           ))}
                        </div>
                      </div>

                      <div className="p-6 border border-zinc-800 bg-zinc-900 rounded-2xl">
                        <h4 className="text-sm font-semibold mb-4">Model Retraining</h4>
                        <p className="text-xs text-zinc-500 mb-4">Latest training batch: Today, 03:15 AM</p>
                        {user?.role === 'admin' ? (
                          <button 
                            onClick={async () => {
                              try {
                                setLoading(true);
                                const res = await api.post('/retrain');
                                alert(res.data.message);
                              } catch (err) {
                                alert("Failed to trigger retraining. Check permissions.");
                              } finally {
                                setLoading(false);
                              }
                            }}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            Trigger Manual Retraining
                          </button>
                        ) : (
                          <div className="p-3 bg-zinc-800/50 border border-dashed border-zinc-700 rounded-lg text-center">
                            <span className="text-[10px] text-zinc-500 uppercase">Restricted to Admin Role</span>
                          </div>
                        )}
                      </div>
                   </div>
                 </div>
               </motion.div>
            )}
            {view === 'users' && (
              <motion.div
                key="users"
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                   <h2 className="text-2xl font-bold">User Management</h2>
                   <button 
                    onClick={() => {
                      const username = prompt("Username:");
                      const email = prompt("Email:");
                      const password = prompt("Password:");
                      const role = prompt("Role (admin/analyst):") || 'analyst';
                      if (username && email && password) {
                        api.post('/users', { username, email, password, role }).then(() => fetchUsers());
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                   >
                     <User className="w-4 h-4" /> Add New User
                   </button>
                </div>
                
                <div className="border border-zinc-800 bg-zinc-900 rounded-2xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-black/50 border-b border-zinc-800">
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Username</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Email</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Role</th>
                        <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                       {usersList.map((u) => (
                         <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                           <td className="px-6 py-4 text-sm font-medium text-zinc-200">{u.username}</td>
                           <td className="px-6 py-4 text-sm text-zinc-400">{u.email}</td>
                           <td className="px-6 py-4">
                             <span className={cn(
                               "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                               u.role === 'admin' ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                             )}>
                               {u.role}
                             </span>
                           </td>
                           <td className="px-6 py-4 text-right space-x-3">
                             <button 
                              onClick={() => {
                                const newRole = prompt("New Role (admin/analyst):", u.role);
                                const newEmail = prompt("New Email:", u.email);
                                if (newRole && newEmail) {
                                  api.put(`/users/${u.id}`, { username: u.username, role: newRole, email: newEmail }).then(() => fetchUsers());
                                }
                              }}
                              className="text-xs text-zinc-500 hover:text-white transition-colors"
                             >
                               Edit
                             </button>
                             <button 
                              onClick={() => {
                                if (confirm("Are you sure?")) {
                                  api.delete(`/users/${u.id}`).then(() => fetchUsers());
                                }
                              }}
                              className="text-xs text-red-500/70 hover:text-red-500 transition-colors"
                             >
                               Delete
                             </button>
                           </td>
                         </tr>
                       ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
            {view === 'sentinel' && (
              <motion.div
                key="sentinel"
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                   <h2 className="text-2xl font-bold">Sentinel Surveillance</h2>
                   <div className="flex items-center gap-4">
                      {location && (
                        <span className="text-xs text-zinc-500 font-mono">
                          FIX: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                        </span>
                      )}
                      <button 
                        onClick={async () => {
                          if (!location) return;
                          try {
                            setAnalyzing(true);
                            const res = await api.post('/analyze-surroundings', location);
                            setEnvAnalysis(res.data);
                          } catch (err) {
                            alert("Analysis failed.");
                          } finally {
                            setAnalyzing(false);
                          }
                        }}
                        disabled={!location || analyzing}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                      >
                        <Zap className={cn("w-4 h-4", analyzing && "animate-pulse")} /> 
                        {analyzing ? "Analyzing..." : "Perform AI Scan"}
                      </button>
                   </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 h-[600px] border border-zinc-800 rounded-2xl overflow-hidden relative">
                    {!MAPS_API_KEY ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 flex-col p-8 text-center">
                        <ShieldAlert className="w-12 h-12 text-zinc-700 mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Satellite Engine Offline</h3>
                        <p className="text-sm text-zinc-500 max-w-sm mb-6">
                          To enable high-resolution satellite tracking, add your Google Maps API key to secrets.
                        </p>
                        <div className="p-4 bg-zinc-800 rounded-lg text-left text-xs space-y-2">
                           <p>1. Open <b>Settings (⚙️)</b> → <b>Secrets</b></p>
                           <p>2. Name: <code>GOOGLE_MAPS_PLATFORM_KEY</code></p>
                           <p>3. Value: <i>[Your Google Maps API Key]</i></p>
                        </div>
                      </div>
                    ) : (
                      <APIProvider apiKey={MAPS_API_KEY}>
                        <Map
                          defaultCenter={location || { lat: 0, lng: 0 }}
                          center={location}
                          defaultZoom={15}
                          mapId="90f87356961a9b00"
                          mapTypeId="satellite"
                          gestureHandling={'greedy'}
                          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                          style={{ width: '100%', height: '100%' }}
                        >
                          {location && (
                            <AdvancedMarker position={location}>
                              <Pin background={'#3b82f6'} glyphColor={'#fff'} borderColor={'#1d4ed8'} />
                            </AdvancedMarker>
                          )}
                        </Map>
                      </APIProvider>
                    )}
                  </div>

                  <div className="space-y-6">
                    <div className="p-6 border border-zinc-800 bg-zinc-900 rounded-2xl">
                      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                        <Navigation className="w-4 h-4 text-blue-400" />
                        Environmental Intel
                      </h3>
                      {envAnalysis ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                             <span className="text-xs text-zinc-500 uppercase tracking-widest">Local Risk Index</span>
                             <span className={cn(
                               "text-2xl font-bold",
                               envAnalysis.risk_score > 70 ? "text-red-500" : envAnalysis.risk_score > 40 ? "text-yellow-500" : "text-emerald-500"
                             )}>
                               {envAnalysis.risk_score}%
                             </span>
                          </div>
                          
                          <div>
                            <p className="text-xs text-zinc-400 leading-relaxed italic border-l-2 border-zinc-800 pl-3">
                              "{envAnalysis.summary}"
                            </p>
                          </div>

                          <div className="space-y-2">
                             <p className="text-[10px] font-bold text-zinc-600 uppercase">Primary Threats</p>
                             <div className="flex flex-wrap gap-2">
                               {envAnalysis.top_threats.map((t: string) => (
                                 <span key={t} className="px-2 py-1 bg-zinc-800 text-[10px] text-zinc-300 rounded border border-zinc-700">
                                   {t}
                                 </span>
                               ))}
                             </div>
                          </div>

                          <div className="space-y-2">
                             <p className="text-[10px] font-bold text-zinc-600 uppercase">Field Directives</p>
                             <ul className="space-y-2">
                               {envAnalysis.recommendations.map((r: string) => (
                                 <li key={r} className="text-xs text-zinc-400 flex items-start gap-2">
                                   <ChevronRight className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                   {r}
                                 </li>
                               ))}
                             </ul>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Crosshair className="w-8 h-8 text-zinc-700 mb-2" />
                          <p className="text-xs text-zinc-500">
                            Awaiting sensor data. Trigger AI Scan to interpret local environment.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      
      {/* Real-time Notification Banner */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] w-full max-w-lg px-4"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 flex items-start gap-4 backdrop-blur-xl bg-zinc-900/90">
              <div className={cn(
                "p-2 rounded-lg shrink-0",
                notification.severity === 'CRITICAL' ? "bg-red-600" : "bg-yellow-600"
              )}>
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-bold text-zinc-100">New {notification.severity} Alert</h4>
                  <span className="text-[10px] text-zinc-500 font-mono">{notification.date}</span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed truncate">{notification.message}</p>
                <div className="mt-2 flex gap-3">
                  <button 
                    onClick={() => {
                      setView('alerts');
                      setNotification(null);
                    }}
                    className="text-[10px] font-bold text-blue-400 uppercase tracking-widest hover:text-blue-300 transition-colors"
                  >
                    View Details
                  </button>
                  <button 
                    onClick={() => setNotification(null)}
                    className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest hover:text-zinc-300 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mb-4"
          />
          <p className="text-zinc-100 font-medium animate-pulse">Running Predictions & AI Analysis...</p>
        </div>
      )}
    </div>
  );
}
