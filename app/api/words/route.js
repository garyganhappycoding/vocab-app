import { Client } from "@notionhq/client";
import { NextResponse } from "next/server";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

let cachedDataSourceId = null;

async function getDataSourceId() {
  if (cachedDataSourceId) return cachedDataSourceId;
  const dbMeta = await notion.databases.retrieve({ database_id: DATABASE_ID });
  const id = dbMeta.data_sources?.[0]?.id;
  if (!id) throw new Error("No data source found for this database.");
  cachedDataSourceId = id;
  return id;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const theme = searchParams.get("theme");
  const mode = searchParams.get("mode") ?? "new"; // "new" | "review"
  const after = Number(searchParams.get("after") ?? 0);
  const before = Number(searchParams.get("before") ?? 0);
  const limit = Number(searchParams.get("limit") ?? 10);

  if (!theme) {
    return NextResponse.json({ error: "theme is required" }, { status: 400 });
  }
  if (!process.env.NOTION_API_KEY || !DATABASE_ID) {
    return NextResponse.json({ error: "Notion credentials are not configured yet." }, { status: 500 });
  }

  try {
    const dataSourceId = await getDataSourceId();

    // "new" mode: words the user hasn't reached yet (order > after), capped to `limit`.
    // "review" mode: everything the user has already covered (order <= before), no cap.
    const orderFilter =
      mode === "review"
        ? { property: "order", number: { less_than_or_equal_to: before } }
        : { property: "order", number: { greater_than: after } };

    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [{ property: "Theme", select: { equals: theme } }, orderFilter],
      },
      sorts: [{ property: "order", direction: "ascending" }],
      page_size: mode === "review" ? 100 : limit,
    });

    const words = response.results.map((page) => {
      const p = page.properties;
      return {
        id: page.id,
        word: p.Word?.title?.[0]?.plain_text ?? "",
        definition: p.Definition?.rich_text?.[0]?.plain_text ?? "",
        example: p.Example?.rich_text?.[0]?.plain_text ?? "",
        order: p.order?.number ?? 0,
        theme: p.Theme?.select?.name ?? null,
        contextSentence: p.context_sentence?.rich_text?.[0]?.plain_text ?? "",
        mandarinDefinition: p.mandarin_definition?.rich_text?.[0]?.plain_text ?? "",
        examinerTip: p.examiner_tip?.rich_text?.[0]?.plain_text ?? "",
        isPastYear: p.is_past_year?.checkbox ?? false,
        sourceTag: p.source_tag?.rich_text?.[0]?.plain_text ?? "",
        sentencePrompt: p.sentence_prompt?.rich_text?.[0]?.plain_text ?? "",
      };
    });

    return NextResponse.json({ words });
  } catch (err) {
    console.error("Notion fetch failed:", err);
    return NextResponse.json({ error: "Could not fetch words from Notion." }, { status: 500 });
  }
}