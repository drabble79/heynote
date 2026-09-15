import '../src/css/application.sass'
import '../assets/font/open-sans/open-sans.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config';

import App from '../src/components/App.vue'
import { loadCurrencies } from '../src/currency'
import { initHeynoteStore } from '../src/stores/heynote-store'
import { useSyncStore } from '../src/stores/sync-store'

// window.heynote is already installed by boot.js before this module is imported

document.documentElement.style.setProperty(
    "--left-panel-width",
    `${window.heynote.settings.leftPanelWidth}px`,
)

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.use(PrimeVue)
app.mount('#app')

useSyncStore().setUp()
initHeynoteStore()

// load math.js currencies
loadCurrencies()
setInterval(loadCurrencies, 1000 * 3600 * 4)
