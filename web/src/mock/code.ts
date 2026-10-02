/** Kaçış karakterlerini olduğu gibi bırakan, baştaki boş satırı atan şablon etiketi (mock kaynak kodu için). */
export function code(strings: TemplateStringsArray, ...values: unknown[]): string {
  return String.raw({ raw: strings }, ...values).replace(/^\n/, '');
}
