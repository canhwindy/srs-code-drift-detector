import * as React from "react";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import { EditorStyleHelper } from "@shared/editor/styles/EditorStyleHelper";

type Props = {
  children?: React.ReactNode;
  maxWidth?: string;
  withStickyHeader?: boolean;
  leftAligned?: boolean;
};

const Container = styled.div<Props>`
  width: 100%;
  max-width: 100vw;
  padding: ${(props) => (props.withStickyHeader ? "4px 12px" : "60px 12px")};

  ${breakpoint("tablet")`
    padding: ${(props: Props) =>
      props.withStickyHeader ? "4px 32px 60px" : "60px 32px"};
  `};
`;

type ContentProps = { $maxWidth?: string; $leftAligned?: boolean };

const Content = styled.div<ContentProps>`
  max-width: ${(props) => props.$maxWidth ?? "56em"};
  margin: ${(props) => (props.$leftAligned ? "0" : "0 auto")};

  ${breakpoint("desktopLarge")`
    max-width: ${(props: ContentProps) => props.$maxWidth ?? EditorStyleHelper.documentWidth};
  `};
`;

const CenteredContent: React.FC<Props> = ({
  children,
  maxWidth,
  leftAligned,
  ...rest
}: Props) => (
  <Container {...rest}>
    <Content $maxWidth={maxWidth} $leftAligned={leftAligned}>{children}</Content>
  </Container>
);

export default CenteredContent;
