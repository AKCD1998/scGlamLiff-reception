import 'dotenv/config';
import { createApp } from './src/app.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 5050;

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
