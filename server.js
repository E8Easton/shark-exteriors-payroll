const createApp = require('./app');

const app = createApp();
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shark Exteriors Payroll running on http://localhost:${PORT}`);
  });
}

module.exports = app;
