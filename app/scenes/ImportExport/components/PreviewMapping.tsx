import { observer } from "mobx-react";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { BootstrapIcon } from "./BootstrapIcon";

// Types matching API response
type DocumentNode = {
  heading: string;
  level: number;
  contentHtml: string | null;
  contentMarkdown: string | null;
  contentDocxBase64: string | null;
  children: DocumentNode[];
  statistics: {
    paragraphCount: number;
    tableCount: number;
    imageCount: number;
    wordCount: number;
  };
};

type HeadingLevelInfo = {
  level: number;
  fontSize: number | null;
  styleName: string | null;
  paragraphCount: number;
  detectionMethod: string;
};

type DocumentSplitResponse = {
  fileName: string;
  documentTree: DocumentNode[];
  detectedHeadingLevels: HeadingLevelInfo[];
  bodyTextFontSize: number | null;
  statistics: {
    totalNodes: number;
    maxDepth: number;
    totalParagraphs: number;
    totalTables: number;
    totalImages: number;
    processedAt: string;
    processingTimeMs: number;
  };
  warnings: string[];
  success: boolean;
  errorMessage: string | null;
};

type Props = {
  file: File;
  splitData: DocumentSplitResponse;
  onCollectionNameChange?: (name: string) => void;
  onSelectedNodesChange?: (nodes: Record<string, boolean>) => void;
};

type FlatNode = {
  id: string;
  heading: string;
  level: number;
  paragraphCount: number;
  tableCount: number;
  selected: boolean;
};

const PreviewMapping = observer(({ file, splitData, onCollectionNameChange, onSelectedNodesChange }: Props) => {
  const { t } = useTranslation();

  // Flatten tree to list for display
  const flattenedNodes = useMemo(() => {
    const result: FlatNode[] = [];
    let idCounter = 0;

    const flatten = (nodes: DocumentNode[]) => {
      nodes.forEach((node) => {
        result.push({
          id: `node-${idCounter++}`,
          heading: node.heading,
          level: node.level,
          paragraphCount: node.statistics.paragraphCount,
          tableCount: node.statistics.tableCount,
          selected: true, // default selected
        });

        if (node.children.length > 0) {
          flatten(node.children);
        }
      });
    };

    flatten(splitData.documentTree);
    return result;
  }, [splitData]);

  const [selectedNodes, setSelectedNodes] = useState<Record<string, boolean>>(
    flattenedNodes.reduce((acc, node) => ({ ...acc, [node.id]: true }), {})
  );

  const [collectionName, setCollectionName] = useState(
    file.name.replace(/\.(docx|doc)$/i, "")
  );

  // Update parent when collection name changes
  useEffect(() => {
    if (onCollectionNameChange) {
      onCollectionNameChange(collectionName);
    }
  }, [collectionName, onCollectionNameChange]);

  const selectedCount = Object.values(selectedNodes).filter(Boolean).length;

  const toggleNode = (id: string) => {
    setSelectedNodes((prev) => {
      const updated = { ...prev, [id]: !prev[id] };
      if (onSelectedNodesChange) {
        onSelectedNodesChange(updated);
      }
      return updated;
    });
  };

  const toggleAll = (checked: boolean) => {
    const updated = flattenedNodes.reduce((acc, node) => ({ ...acc, [node.id]: checked }), {});
    setSelectedNodes(updated);
    if (onSelectedNodesChange) {
      onSelectedNodesChange(updated);
    }
  };

  return (
    <Container>
      <SplitLayout>
        {/* Left Panel - Configuration */}
        <LeftPanel>
          <ConfigSection>
            <SectionTitle>
              {t("Configuration")}
            </SectionTitle>

            <OptionGroup>
              <Label>{t("Collection Name")}</Label>
              <Input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder={t("Enter collection name...")}
              />
              <HelpText>{t("Documents will be imported into this collection")}</HelpText>
            </OptionGroup>

            <StatsBox>
              <StatItem>
                <StatLabel>{t("Total Sections")}</StatLabel>
                <StatValue>{splitData.statistics.totalNodes}</StatValue>
              </StatItem>
              <StatItem>
                <StatLabel>{t("Max Depth")}</StatLabel>
                <StatValue>{splitData.statistics.maxDepth} {t("levels")}</StatValue>
              </StatItem>
              <StatItem>
                <StatLabel>{t("Paragraphs")}</StatLabel>
                <StatValue>{splitData.statistics.totalParagraphs}</StatValue>
              </StatItem>
              <StatItem>
                <StatLabel>{t("Tables")}</StatLabel>
                <StatValue>{splitData.statistics.totalTables}</StatValue>
              </StatItem>
              {splitData.detectedHeadingLevels && splitData.detectedHeadingLevels.length > 0 && (
                <StatItem style={{ gridColumn: "1 / -1" }}>
                  <StatLabel>{t("Detected Headings")}</StatLabel>
                  <StatValue style={{ fontSize: 12 }}>
                    {splitData.detectedHeadingLevels.map(h =>
                      `L${h.level}: ${h.fontSize !== null ? `${h.fontSize}pt` : h.styleName}`
                    ).join(" → ")}
                    {splitData.bodyTextFontSize !== null && (
                      ` | ${t("Body")}: ${splitData.bodyTextFontSize}pt`
                    )}
                  </StatValue>
                </StatItem>
              )}
            </StatsBox>
          </ConfigSection>
        </LeftPanel>

        {/* Right Panel - Preview */}
        <RightPanel>
          <PreviewSection>
            <PreviewHeader>
              <HeaderTop>
                <PreviewTitle>{t("Document Structure")}</PreviewTitle>
                <StatusBadge>
                  <BootstrapIcon name="check-circle-fill" size={14} />
                  {selectedCount} / {flattenedNodes.length} {t("selected")}
                </StatusBadge>
              </HeaderTop>
              <HeaderSub>
                {t("Select sections to import into collection")}
              </HeaderSub>
            </PreviewHeader>

            <TableContainer>
              <Table>
                <thead>
                  <TableHeaderRow>
                    <TableHeaderCell $width="44px">
                      <StyledCheckbox
                        type="checkbox"
                        checked={selectedCount === flattenedNodes.length}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                    </TableHeaderCell>
                    <TableHeaderCell>{t("Level")}</TableHeaderCell>
                    <TableHeaderCell $grow>{t("Heading")}</TableHeaderCell>
                    <TableHeaderCell>{t("Content")}</TableHeaderCell>
                  </TableHeaderRow>
                </thead>
                <tbody>
                  {flattenedNodes.map((node) => (
                    <TableBodyRow key={node.id}>
                      <TableCell $width="44px">
                        <StyledCheckbox
                          type="checkbox"
                          checked={selectedNodes[node.id] || false}
                          onChange={() => toggleNode(node.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <LevelBadge $level={node.level}>
                          L{node.level}
                        </LevelBadge>
                      </TableCell>
                      <TableCell $grow>
                        <HeadingText $level={node.level}>
                          <Indent $level={node.level} />
                          {node.heading || t("(Untitled)")}
                        </HeadingText>
                      </TableCell>
                      <TableCell>
                        <ContentMeta>
                          {node.paragraphCount > 0 && (
                            <MetaItem>
                              {node.paragraphCount}p
                            </MetaItem>
                          )}
                          {node.tableCount > 0 && (
                            <MetaItem>
                              {node.tableCount}t
                            </MetaItem>
                          )}
                        </ContentMeta>
                      </TableCell>
                    </TableBodyRow>
                  ))}
                </tbody>
              </Table>
            </TableContainer>

            <SummaryBar>
              <SummaryItem>
                <SummaryLabel>{selectedCount}</SummaryLabel>
                <SummaryValue>{t("documents to import")}</SummaryValue>
              </SummaryItem>
              <Divider />
              <SummaryItem>
                <SummaryLabel>{file.name}</SummaryLabel>
                <SummaryValue>{t("source file")}</SummaryValue>
              </SummaryItem>
            </SummaryBar>
          </PreviewSection>
        </RightPanel>
      </SplitLayout>
    </Container>
  );
});

// Styled Components
const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SplitLayout = styled.div`
  display: flex;
  gap: 24px;

  @media (max-width: 1024px) {
    flex-direction: column;
  }
`;

const LeftPanel = styled.div`
  width: 320px;
  flex-shrink: 0;

  @media (max-width: 1024px) {
    width: 100%;
  }
`;

const RightPanel = styled.div`
  flex: 1;
  min-width: 0;
`;

const ConfigSection = styled.div`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  padding: 20px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05)"};
`;

const SectionTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: ${s("text")};
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const OptionGroup = styled.div`
  margin-bottom: 20px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: ${s("textSecondary")};
  margin-bottom: 8px;
`;

const Input = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  font-size: 14px;
  color: ${s("text")};
  background: ${s("background")};
  transition: all 200ms ease;

  &:focus {
    outline: none;
    border-color: ${s("inputBorderFocused")};
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

const HelpText = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
  margin-top: 6px;
`;

const StatsBox = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid ${s("divider")};
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StatLabel = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const StatValue = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${s("text")};
`;

const PreviewSection = styled.div`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  overflow: hidden;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05)"};
`;

const PreviewHeader = styled.div`
  padding: 20px;
  border-bottom: 1px solid ${s("divider")};
`;

const HeaderTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const PreviewTitle = styled.h3`
  font-size: 16px;
  font-weight: 700;
  color: ${s("text")};
  margin: 0;
`;

const StatusBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: ${(props) =>
    props.theme.isDark ? "rgba(16, 185, 129, 0.15)" : "#ECFDF5"};
  color: #10B981;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
`;

const HeaderSub = styled.div`
  font-size: 13px;
  color: ${s("textTertiary")};
`;

const TableContainer = styled.div`
  max-height: 500px;
  overflow-y: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const TableHeaderRow = styled.tr`
  background: ${s("backgroundSecondary")};
  border-bottom: 1px solid ${s("divider")};
`;

const TableHeaderCell = styled.th<{ $width?: string; $grow?: boolean }>`
  padding: 12px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: ${s("textTertiary")};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: ${(props) => props.$width || "auto"};
  flex: ${(props) => (props.$grow ? 1 : "none")};
`;

const TableBodyRow = styled.tr`
  border-bottom: 1px solid ${(props) =>
    props.theme.isDark ? props.theme.backgroundSecondary : "#F3F4F6"};

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const TableCell = styled.td<{ $width?: string; $grow?: boolean }>`
  padding: 12px 16px;
  font-size: 13px;
  color: ${s("textSecondary")};
  width: ${(props) => props.$width || "auto"};
  flex: ${(props) => (props.$grow ? 1 : "none")};
`;

const StyledCheckbox = styled.input`
  width: 16px;
  height: 16px;
  cursor: pointer;
`;

const LevelBadge = styled.span<{ $level: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  background: ${(props) => {
    if (props.theme.isDark) {
      if (props.$level === 1) {
        return "rgba(59, 130, 246, 0.2)";
      }
      if (props.$level === 2) {
        return "rgba(99, 102, 241, 0.2)";
      }
      if (props.$level === 3) {
        return "rgba(236, 72, 153, 0.2)";
      }
      return props.theme.backgroundSecondary;
    }
    if (props.$level === 1) {
      return "#DBEAFE";
    }
    if (props.$level === 2) {
      return "#E0E7FF";
    }
    if (props.$level === 3) {
      return "#FCE7F3";
    }
    return "#F3F4F6";
  }};
  color: ${(props) => {
    if (props.theme.isDark) {
      if (props.$level === 1) {
        return "#60A5FA";
      }
      if (props.$level === 2) {
        return "#818CF8";
      }
      if (props.$level === 3) {
        return "#F472B6";
      }
      return props.theme.textTertiary;
    }
    if (props.$level === 1) {
      return "#1E40AF";
    }
    if (props.$level === 2) {
      return "#4338CA";
    }
    if (props.$level === 3) {
      return "#BE185D";
    }
    return "#6B7280";
  }};
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
`;

const HeadingText = styled.div<{ $level: number }>`
  display: flex;
  align-items: center;
  font-weight: ${(props) => (props.$level <= 2 ? 600 : 400)};
  color: ${(props) => (props.$level === 1 ? props.theme.text : props.theme.textSecondary)};
`;

const Indent = styled.span<{ $level: number }>`
  display: inline-block;
  width: ${(props) => (props.$level - 1) * 20}px;
`;

const ContentMeta = styled.div`
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const MetaItem = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const SummaryBar = styled.div`
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  background: ${s("backgroundSecondary")};
  border-top: 1px solid ${s("divider")};
`;

const SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SummaryLabel = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${s("text")};
`;

const SummaryValue = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const Divider = styled.div`
  width: 1px;
  height: 32px;
  background: ${s("divider")};
`;

export default PreviewMapping;
