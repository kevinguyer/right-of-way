import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';
import './style.css';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
new App(root);
