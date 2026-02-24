export const PHOTO_TAG_PROMPT = `You are analyzing construction/renovation job photos. For each image, extract structured tags.

Return a JSON object with:
- room: string (e.g. "Kitchen", "Living Room", "Bathroom", "Hallway")
- surfaceType: string (e.g. "vinyl plank", "hardwood", "tile", "carpet")
- condition: string (e.g. "worn", "damaged", "good", "needs removal")
- tasks: string[] (e.g. ["remove existing floor", "install underlayment", "install vinyl plank"])
- materials: string[] (e.g. ["vinyl plank", "underlayment", "transition strips"])
- confidence: number 0-1

Be concise. Base tags only on what is visible.`;

export const SCOPE_SYNTHESIS_PROMPT = `You are building a work scope from tagged photos and job context.

Given:
1. Job description/prompt from the contractor
2. Per-photo tags (room, surfaceType, condition, tasks, materials)
3. Project details: address, province, square footage

Produce a consolidated scope as JSON array of scope items. Each item:
- segment: string (room or area name)
- task: string (specific work item)
- material: string
- quantity: number (estimate based on sqft/visible area)
- unit: string ("sqft", "linear ft", "each")
- laborHours: number (estimate)
- source: "AI"

Group similar items. Use the job prompt to infer total scope. Be realistic for Canadian renovation work.`;

export function buildPhotoTagContext(jobPrompt?: string | null, sqft?: string) {
  const parts: string[] = [];
  if (jobPrompt) parts.push(`Job context: ${jobPrompt}`);
  if (sqft) parts.push(`Total area: ~${sqft} sqft`);
  return parts.length ? parts.join("\n") : "";
}

export function buildScopeContext(
  jobPrompt?: string | null,
  address?: string,
  province?: string,
  sqft?: string
) {
  const parts: string[] = [];
  if (address) parts.push(`Address: ${address}`);
  if (province) parts.push(`Province: ${province}`);
  if (sqft) parts.push(`Square footage: ${sqft}`);
  if (jobPrompt) parts.push(`Job: ${jobPrompt}`);
  return parts.join("\n");
}
