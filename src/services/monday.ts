const MONDAY_API_URL = 'https://api.monday.com/v2';

interface MondayBoard {
  id: string;
  name: string;
}

interface MondayItem {
  id: string;
  name: string;
  column_values: Array<{ id: string; title: string; text: string }>;
  updates: Array<{ text_body: string; created_at: string }>;
}

async function mondayQuery(apiKey: string, query: string, variables?: Record<string, any>) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status}`);
  }

  const data: any = await response.json();
  if (data.errors) {
    throw new Error(`Monday.com GraphQL error: ${data.errors[0].message}`);
  }

  return data.data;
}

export async function searchBoards(apiKey: string, searchTerm?: string): Promise<MondayBoard[]> {
  const query = `query {
    boards(limit: 20${searchTerm ? `, order_by: used_at` : ''}) {
      id
      name
    }
  }`;

  const data = await mondayQuery(apiKey, query);
  const boards = data.boards as MondayBoard[];

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    return boards.filter((b) => b.name.toLowerCase().includes(term));
  }

  return boards;
}

export async function getBoardItems(
  apiKey: string,
  boardId: string
): Promise<Array<{ id: string; name: string }>> {
  const query = `query ($boardId: [ID!]!) {
    boards(ids: $boardId) {
      items_page(limit: 50) {
        items {
          id
          name
        }
      }
    }
  }`;

  const data = await mondayQuery(apiKey, query, { boardId: [boardId] });
  return data.boards[0]?.items_page?.items || [];
}

export async function getItemDetails(apiKey: string, itemId: string): Promise<MondayItem | null> {
  const query = `query ($itemId: [ID!]!) {
    items(ids: $itemId) {
      id
      name
      column_values {
        id
        title
        text
      }
      updates(limit: 10) {
        text_body
        created_at
      }
    }
  }`;

  const data = await mondayQuery(apiKey, query, { itemId: [itemId] });
  return data.items?.[0] || null;
}

export function extractContextFromItem(item: MondayItem): string {
  const lines: string[] = [`Project: ${item.name}`];

  // Add column values that have content
  for (const col of item.column_values) {
    if (col.text && col.text.trim()) {
      lines.push(`${col.title}: ${col.text}`);
    }
  }

  // Add recent updates as context
  if (item.updates.length > 0) {
    lines.push('\nRecent Updates:');
    for (const update of item.updates.slice(0, 5)) {
      lines.push(`- ${update.text_body}`);
    }
  }

  return lines.join('\n');
}
