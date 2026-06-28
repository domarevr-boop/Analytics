import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initStore } from './data/store'

async function main() {
  try {
    await initStore();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (e) {
    document.getElementById('root')!.innerHTML = `<div style="padding:40px;font-family:sans-serif"><h2>Ошибка загрузки</h2><pre style="color:red">${e instanceof Error ? e.message + '\n' + e.stack : String(e)}</pre><p>Проверь консоль (F12)</p></div>`;
    throw e;
  }
}
main();
