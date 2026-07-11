export function setAttributes(element: Element, attributes: Record<string, string>) {
  for (const key in attributes) {
    element.setAttribute(key, attributes[key]);
  }
}
