import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, MD } from "@/components/report/Markdown";

describe("MD (inline)", () => {
  it("renders bold", () => {
    const { container } = render(<MD>{"a **bold** word"}</MD>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders a bullish span", () => {
    const { container } = render(<MD>{"growth of {+ +221% YoY +} here"}</MD>);
    const span = container.querySelector("span.pos");
    expect(span?.textContent).toBe("+221% YoY");
  });

  it("renders a bearish span", () => {
    const { container } = render(<MD>{"a {- -3.3% -} decline"}</MD>);
    expect(container.querySelector("span.neg")?.textContent).toBe("-3.3%");
  });

  it("drops the delimiter padding so punctuation hugs the span", () => {
    const { container } = render(<MD>{"an FCF margin of {- -35.2% -}. Measured"}</MD>);
    expect(container.textContent).toBe("an FCF margin of -35.2%. Measured");
  });

  it("returns null for null input", () => {
    const { container } = render(<div><MD>{null}</MD></div>);
    expect(container.firstChild?.textContent).toBe("");
  });
});

describe("Markdown (block)", () => {
  it("splits blank lines into paragraphs", () => {
    const { container } = render(<Markdown text={"one\n\ntwo"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("renders a bullet block as a list", () => {
    const { container } = render(<Markdown text={"- alpha\n- beta"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders sub-headings", () => {
    render(<Markdown text={"### Heading"} />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Heading");
  });

  it("joins soft line breaks inside a paragraph", () => {
    const { container } = render(<Markdown text={"one\ntwo"} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("one two");
  });
});
