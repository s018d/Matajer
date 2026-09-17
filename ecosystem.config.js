module.exports = {
  apps: [{
    name: 'matajer',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      TRUST_PROXY: '1',
      DISABLE_SAMPLES: '1'
    },
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    merge_logs: true,
    time: true
  }]
};