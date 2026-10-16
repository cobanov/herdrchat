import { agentOfIntegration, AGENTS, integrationFor } from '../herdr/agents';
import { agentName } from '../herdr/models';
import known from './fixtures/herdr-agents.json';

// What herdr 0.9.5 answers: `server.agent_manifests` (the agents it detects)
// and `herdr integration status` (the integrations it installs). A newer herdr
// that adds one fails here until the table names it (HC-124).
describe('the agent table against herdr', () => {
  it.each(known.manifests)('names %s', (kind) => {
    expect(AGENTS[kind]).toBeDefined();
    expect(agentName(kind)).not.toBe(kind);
  });

  it.each(known.integrations)('knows the agent of the %s integration', (integration) => {
    const kind = agentOfIntegration(integration);
    expect(AGENTS[kind]).toBeDefined();
    expect(integrationFor(kind)).toBe(integration);
  });
});
