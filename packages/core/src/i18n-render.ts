/** Render `{placeholder}` templates. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | boolean | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}
