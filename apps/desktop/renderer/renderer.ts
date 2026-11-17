import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import 'element-plus/theme-chalk/el-button.css';
import 'element-plus/theme-chalk/base.css';
import type { OperationName, Response } from '../../../packages/contracts/protocol.ts';
declare global { interface Window { codexDog: { request(operation: OperationName, params?: Record<string, unknown>, idempotencyKey?: string): Promise<Response> } } }
createApp(App).use(createPinia()).mount('#app');
