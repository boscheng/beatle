import Beatle from '../src';
import './index.less';

const app = new Beatle({
  name: 'main',
  root: document.getElementById('container'),
  base: window.CONFIG.prefix,
  routes: require.context('./scenes', true, /index\.(jsx|js)$/)
});
app.run();
