// How each engine is pointed at the brain, told to work without asking, and asked for a machine-readable transcript,
// inside the trial's container (HOME=/home/agent, the workspace at /work). Versions are pinned here and in Dockerfile.
// Sources (2026-11-08): opencode V2 docs and source (github.com/anomalyco/opencode, v2.2.6); Qwen Code docs
// (github.com/QwenLM/qwen-code, v0.27.0). Each engine's telemetry, update checks and extra cloud lookups are off.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLING = { temperature: 0.6, top_p: 0.95, top_k: 20 };   // the brain's agent setup (contract 3.8)
const write = (file, value) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };

export const ENGINES = {
  opencode: {
    version: '@opencode/cli 2.2.6',
    configure({ home, brain, model, context, maxTokens }) {
      write(join(home, '.config/opencode/opencode.json'), {
        $schema: 'https://opencode.ai/config.json',
        update: 'disable',
        model: `sglang/${model}`,
        // Only the brain: no cloud provider can be used, even by mistake.
        policies: [{ action: 'provider.use', resource: '*', effect: 'deny' }, { action: 'provider.use', resource: 'sglang', effect: 'allow' }],
        agents: { build: { steps: 300 }, title: { model: `sglang/${model}` } },
        providers: { sglang: {
          package: '@opencode/ai/providers/openai-compatible',
          // (a long prompt on a Spark can take minutes before the first token)
          settings: { baseURL: brain, headerTimeout: 600000 },
          models: { [model]: {
            capabilities: { tools: true, input: ['text'], output: ['text'] },
            limit: { context, output: maxTokens },
            compatibility: { maxTokensField: 'max_tokens' },
            body: { ...SAMPLING, chat_template_kwargs: { enable_thinking: true } },
          } },
        } },
      });
      return { PWD: '/work', XDG_CONFIG_HOME: '/home/agent/.config', XDG_DATA_HOME: '/home/agent/.local/share', XDG_CACHE_HOME: '/home/agent/.cache',
        XDG_STATE_HOME: '/home/agent/.local/state', OPENCODE_DISABLE_FREE_MODELS: '1' };
    },
    // --standalone: its own session, not a shared background service. --auto: no approval prompts (the container is the
    // fence). Without a wall-clock flag, run.mjs's `timeout` stops it.
    command: ({ prompt, model }) => ['opencode', 'run', '--standalone', '--auto', '--format', 'json', '--thinking', '-m', `sglang/${model}`, prompt],
  },

  qwen: {
    version: '@qwen-code/qwen-code 0.27.0',
    configure({ home, brain, model, context, maxTokens }) {
      write(join(home, '.qwen/settings.json'), {
        security: { auth: { selectedType: 'openai' } },
        env: { SGL_KEY: 'none' },
        // (its own logs stay out of the workspace being graded)
        model: { name: model, enableOpenAILogging: true, openAILoggingDir: '/home/agent/api-logs' },
        modelProviders: { openai: [{
          id: model, envKey: 'SGL_KEY', baseUrl: brain,
          capabilities: { reasoning: { profile: 'qwen-chat-template' } },
          generationConfig: { timeout: 600000, streamIdleTimeoutMs: 600000, contextWindowSize: context,
            samplingParams: { ...SAMPLING, max_tokens: maxTokens } },
        }] },
        context: { fileName: ['AGENTS.md', 'QWEN.md'] },
        general: { enableAutoUpdate: false },
        privacy: { usageStatisticsEnabled: false },
        telemetry: { enabled: false },
        agents: { crossSessionMessaging: false },
        // (its background memory delays a headless answer by minutes, and can't save there anyway)
        memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false },
      });
      return { QWEN_HOME: '/home/agent/.qwen', SGL_KEY: 'none', QWEN_CODE_SUPPRESS_YOLO_WARNING: '1', QWEN_USAGE_STATISTICS_ENABLED: 'false',
        QWEN_TELEMETRY_ENABLED: 'false', QWEN_CODE_MODELS_DEV_REFRESH: 'off', QWEN_STREAM_MAX_LIFETIME_MS: '3600000' };
    },
    command: ({ prompt, minutes }) => ['qwen', '-p', prompt, '--yolo', '-o', 'stream-json', '--max-wall-time', `${minutes}m`, '--max-session-turns', '300'],
  },
};
