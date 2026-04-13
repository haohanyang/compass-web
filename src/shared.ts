export function getMetaData(field: string) {
  const element: HTMLMetaElement | null = document.querySelector(
    `meta[name="${field}"]`
  );
  return element?.content;
}

export function getAPIRoute(routeName: string) {
  const baseRoute = getMetaData('base-route');
  return baseRoute ? `/${baseRoute}/api/${routeName}` : `/api/${routeName}`;
}
