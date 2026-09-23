import './styles.css'

import { ViewerApp } from './app.ts'

const root = document.getElementById('app')

if (!root) {
  throw new Error('找不到 #app 容器')
}

const app = new ViewerApp(root)
void app.start()
