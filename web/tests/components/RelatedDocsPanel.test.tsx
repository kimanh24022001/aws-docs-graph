import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelatedDocsPanel } from "@/components/RelatedDocsPanel";
import { FIXTURE_QUERY_RESPONSE } from "../mocks/fixtures";

describe("RelatedDocsPanel", () => {
  it("renders related doc title as external link", () => {
    render(
      <RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />,
    );
    const link = screen.getByRole("link", { name: "AWS Cost Explorer" });
    expect(link).toHaveAttribute(
      "href",
      "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/ce-what-is.html",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders hop count", () => {
    render(
      <RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />,
    );
    expect(screen.getByText(/1 hop/)).toBeInTheDocument();
  });

  it("renders edge path", () => {
    render(
      <RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />,
    );
    expect(screen.getByText("LINKS_TO")).toBeInTheDocument();
  });

  it("renders service badge", () => {
    render(
      <RelatedDocsPanel relatedDocs={FIXTURE_QUERY_RESPONSE.related_docs} />,
    );
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  it("renders empty state when no related docs", () => {
    render(<RelatedDocsPanel relatedDocs={[]} />);
    expect(screen.getByText("No related docs found.")).toBeInTheDocument();
  });
});
