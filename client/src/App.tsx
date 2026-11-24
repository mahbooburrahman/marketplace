import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { SocketProvider } from './context/SocketContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/Layout';
import { ErrorBoundary, RequireAdmin, RequireAuth } from './components/Guards';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import Search from './pages/Search';
import ListingDetail from './pages/ListingDetail';
import SellerProfile from './pages/SellerProfile';
import { ForgotPassword, Login, Register, ResendVerification, ResetPassword, VerifyEmail } from './pages/Auth';
import { LegalPage, NotFound } from './pages/Static';
import { GuideArticle, GuidesIndex } from './pages/Guides';

const Messages = lazy(() => import('./pages/Messages'));
const Dash = {
  Layout: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.DashboardLayout }))),
  Overview: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Overview }))),
  Profile: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Profile }))),
  Favorites: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Favorites }))),
  Notifications: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Notifications }))),
  Status: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.AccountStatus }))),
  Payments: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Payments }))),
  Help: lazy(() => import('./pages/dashboard/Dashboard').then((m) => ({ default: m.Help }))),
  Seller: lazy(() => import('./pages/dashboard/Seller')),
  MyListings: lazy(() => import('./pages/dashboard/MyListings')),
  ListingForm: lazy(() => import('./pages/dashboard/ListingForm')),
};
const Admin = {
  Layout: lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout }))),
  Overview: lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminOverview }))),
  Activity: lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminActivity }))),
  Users: lazy(() => import('./pages/admin/AdminUsers')),
  Sellers: lazy(() => import('./pages/admin/AdminSellers')),
  Plans: lazy(() => import('./pages/admin/AdminSellers').then((m) => ({ default: m.AdminPlans }))),
  Listings: lazy(() => import('./pages/admin/AdminListings')),
  Payments: lazy(() => import('./pages/admin/AdminPayments')),
  Banners: lazy(() => import('./pages/admin/AdminBanners')),
  Categories: lazy(() => import('./pages/admin/AdminCategories')),
  Reports: lazy(() => import('./pages/admin/AdminReports')),
  Settings: lazy(() => import('./pages/admin/AdminSettings')),
  Announcements: lazy(() => import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminAnnouncements }))),
};

const Fallback = () => <div className="py-32 grid place-items-center text-brand"><Spinner size={28} /></div>;

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <SettingsProvider>
            <AuthProvider>
              <SocketProvider>
                <Suspense fallback={<Fallback />}>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<Home />} />
                      <Route path="search" element={<Search />} />
                      <Route path="category/:slug" element={<Search />} />
                      <Route path="city/:city" element={<Search />} />
                      <Route path="city/:city/:slug" element={<Search />} />
                      <Route path="item/:slug" element={<ListingDetail />} />
                      <Route path="seller/:id" element={<SellerProfile />} />
                      <Route path="login" element={<Login />} />
                      <Route path="register" element={<Register />} />
                      <Route path="verify-email" element={<VerifyEmail />} />
                      <Route path="resend-verification" element={<ResendVerification />} />
                      <Route path="forgot-password" element={<ForgotPassword />} />
                      <Route path="reset-password" element={<ResetPassword />} />
                      <Route path="guides" element={<GuidesIndex />} />
                      <Route path="guides/:slug" element={<GuideArticle />} />
                      <Route path="terms" element={<LegalPage />} />
                      <Route path="privacy" element={<LegalPage />} />

                      <Route path="messages" element={<RequireAuth><Messages /></RequireAuth>} />
                      <Route path="messages/:id" element={<RequireAuth><Messages /></RequireAuth>} />

                      <Route path="dashboard" element={<RequireAuth><Dash.Layout /></RequireAuth>}>
                        <Route index element={<Dash.Overview />} />
                        <Route path="profile" element={<Dash.Profile />} />
                        <Route path="favorites" element={<Dash.Favorites />} />
                        <Route path="notifications" element={<Dash.Notifications />} />
                        <Route path="status" element={<Dash.Status />} />
                        <Route path="seller" element={<Dash.Seller />} />
                        <Route path="payments" element={<Dash.Payments />} />
                        <Route path="help" element={<Dash.Help />} />
                        <Route path="listings" element={<Dash.MyListings />} />
                        <Route path="listings/new" element={<Dash.ListingForm />} />
                        <Route path="listings/:id/edit" element={<Dash.ListingForm />} />
                      </Route>

                      <Route path="admin" element={<RequireAdmin><Admin.Layout /></RequireAdmin>}>
                        <Route index element={<Admin.Overview />} />
                        <Route path="users" element={<Admin.Users />} />
                        <Route path="sellers" element={<Admin.Sellers />} />
                        <Route path="plans" element={<Admin.Plans />} />
                        <Route path="listings" element={<Admin.Listings />} />
                        <Route path="payments" element={<Admin.Payments />} />
                        <Route path="banners" element={<Admin.Banners />} />
                        <Route path="categories" element={<Admin.Categories />} />
                        <Route path="reports" element={<Admin.Reports />} />
                        <Route path="announcements" element={<Admin.Announcements />} />
                        <Route path="settings" element={<Admin.Settings />} />
                        <Route path="activity" element={<Admin.Activity />} />
                      </Route>

                      <Route path="*" element={<NotFound />} />
                    </Route>
                  </Routes>
                </Suspense>
              </SocketProvider>
            </AuthProvider>
          </SettingsProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
