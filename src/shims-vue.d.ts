declare module "*.vue" {
  import type { DefineComponent } from "vue";

  // biome-ignore lint/complexity/noBannedTypes lint/suspicious/noExplicitAny: Vue shim with empty props/emit and any template
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
