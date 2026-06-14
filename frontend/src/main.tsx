import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FluentProvider, webDarkTheme } from '@fluentui/react-components'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webDarkTheme} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <App />
      </FluentProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
