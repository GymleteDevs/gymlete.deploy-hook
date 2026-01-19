module.exports = {
    apps: [
        {
            name: "Gymlete Deploy Hook",
            namespace: "GYMLETE_DEPLOY_HOOK",
            script: "deploy.ts",
            interpreter: "bun",
            exec_mode: "fork",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "250M",
            log_date_format: "DD-MM HH:mm:ss Z",
            log_type: "json",
            time: true,
            env: {
                NODE_ENV: "production",
            },
        },
    ],
}
