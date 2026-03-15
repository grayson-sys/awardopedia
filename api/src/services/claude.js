import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function analyzeAward(award, question) {
  const awardContext = `
Federal Contract Award:
- PIID: ${award.award_id_piid || 'N/A'}
- Description: ${award.description || 'N/A'}
- Agency: ${award.agency_name || 'N/A'}
- Contractor: ${award.recipient_name || 'N/A'} (${award.recipient_city || ''}, ${award.recipient_state || ''})
- Federal Obligation: $${award.federal_action_obligation || 0}
- Potential Total Value: $${award.potential_total_value || 0}
- NAICS: ${award.naics_code || 'N/A'} - ${award.naics_description || ''}
- Award Type: ${award.award_type || 'N/A'}
- Contract Type: ${award.contract_type || 'N/A'}
- Period: ${award.period_of_performance_start || 'N/A'} to ${award.period_of_performance_current_end || 'N/A'}
- Action Date: ${award.action_date || 'N/A'}
`.trim();

  const prompt = question
    ? `Based on this federal contract award data, answer the following question: ${question}\n\n${awardContext}`
    : `Analyze this federal contract award. Provide insights on: the scope of work, the contractor, the value relative to typical awards in this NAICS code, and any notable aspects of the contract structure.\n\n${awardContext}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a federal procurement analyst. Provide concise, factual analysis of government contract awards. Focus on actionable insights. Do not speculate beyond what the data supports.',
  });

  return message.content[0].text;
}

export async function summarizeEntity(entityType, entityId) {
  const prompt = `Provide a brief analytical summary of this federal contracting entity.
Entity type: ${entityType}
Entity identifier: ${entityId}

Focus on: what this entity does in federal contracting, scale of operations, and key patterns. Keep it concise (2-3 paragraphs).`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a federal procurement analyst. Provide concise, factual summaries. Do not speculate beyond what is commonly known about this entity.',
  });

  return message.content[0].text;
}
