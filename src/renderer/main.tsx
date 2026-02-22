// 导入 React 核心库
import React from 'react';
// 导入 React DOM 客户端 API，用于渲染 React 应用
import ReactDOM from 'react-dom/client';
// 导入 Redux Provider 组件，用于将 Redux store 提供给 React 组件树
import { Provider } from 'react-redux';
// 导入 Redux store 实例
import { store } from './store';
// 导入根组件 App
import App from './App';
// 导入全局样式文件
import './index.css';

// 获取 DOM 中的根元素，作为 React 应用的挂载点
const rootElement = document.getElementById('root');
// 如果根元素不存在，抛出错误
if (!rootElement) {
  throw new Error('未能找到根元素');
}

try {
  // 使用 React 18 的新 API 创建根节点并渲染应用
  ReactDOM.createRoot(rootElement).render(
    // React.StrictMode 用于检测潜在问题的开发模式工具
    <React.StrictMode>
      {/* Provider 组件将 Redux store 注入到 React 组件树中 */}
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>
  );
} catch (error) {
  // 捕获并输出渲染过程中的错误
  console.error('渲染应用失败:', error);
}
