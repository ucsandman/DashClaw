/**
 * JsonLd — renders a schema.org JSON-LD block for marketing pages
 * (roadmap v6.3). Data is authored inline per page; this component only
 * serializes it. JSON.stringify with the `<` escape prevents any string in
 * the data from closing the script tag early.
 */

export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
