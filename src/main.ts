import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { usePersistStore } from "./stores/persist";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Load persisted state from localStorage
usePersistStore().load();

app.mount("#app");
