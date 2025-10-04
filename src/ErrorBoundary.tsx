import React from 'react'
type P={children:React.ReactNode}; type S={error?:any}
export class ErrorBoundary extends React.Component<P,S>{
  constructor(p:P){super(p);this.state={}}
  static getDerivedStateFromError(error:any){return{error}}
  componentDidCatch(err:any,info:any){console.error('UI error:',err,info)}
  render(){
    if(this.state.error){
      return <div className="p-4">
        <h2 className="text-lg font-semibold">Something went wrong.</h2>
        <pre className="text-sm opacity-80 whitespace-pre-wrap">{String(this.state.error?.message||this.state.error)}</pre>
      </div>
    }
    return this.props.children
  }
}
