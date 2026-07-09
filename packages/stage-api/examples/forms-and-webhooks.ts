import { OoopsStageClient } from '@ooopsstudio/stage-api';

const stage = new OoopsStageClient({
  baseUrl: process.env.OOOPS_STAGE_API_BASE_URL ?? 'https://stage.ooops.work/api/stage/v1',
  token: process.env.OOOPS_STAGE_API_TOKEN ?? ''
});

const forms = await stage.forms.list<{
  ok: true;
  forms: Array<{ id: string; title: string; shareToken?: string | null }>;
}>();

console.log('Forms');
for (const form of forms.forms) {
  console.log(`- ${form.title}: ${form.id}`);
}

const webhook = await stage.webhooks.create<{
  ok: true;
  subscription: { id: string; name: string; eventTypes: string[] };
  signingSecret: string;
}>({
  name: 'CMS publish receiver',
  url: process.env.WEBHOOK_RECEIVER_URL ?? 'https://example.com/stage-webhooks',
  enabled: true,
  eventTypes: ['cms.entry.published']
});

console.log(`Created webhook ${webhook.subscription.id}`);
console.log(`Store this signing secret securely: ${webhook.signingSecret}`);
