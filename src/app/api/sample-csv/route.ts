import { generateSampleCsv } from "@/lib/analytics/sample";

export function GET() {
  return new Response(generateSampleCsv(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="meta_ads_sample.csv"' },
  });
}
