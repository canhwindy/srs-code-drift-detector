import { observer } from "mobx-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { BootstrapIcon } from "./BootstrapIcon";
import Flex from "~/components/Flex";

type Props = {
  file: File;
};

const PreviewMapping = observer(({ file: _file }: Props) => {
  const { t } = useTranslation();
  const [selectedRows, setSelectedRows] = useState<boolean[]>(Array(15).fill(true));

  const mockDocuments = [
    { id: 1, status: "success", name: "UC-01: User Login", existing: "No", action: "Create" },
    { id: 2, status: "success", name: "UC-02: User Registration", existing: "No", action: "Create" },
    { id: 3, status: "warning", name: "UC-03: Password Reset", existing: "Yes", action: "Replace" },
    { id: 4, status: "success", name: "UC-04: Profile Management", existing: "No", action: "Create" },
    { id: 5, status: "success", name: "UC-05: Course Enrollment", existing: "No", action: "Create" },
    { id: 6, status: "warning", name: "UC-06: Course Completion", existing: "Yes", action: "Replace" },
    { id: 7, status: "success", name: "UC-07: Certificate Generation", existing: "No", action: "Create" },
    { id: 8, status: "error", name: "UC-08: [Untitled Section]", existing: "-", action: "Skip" },
    { id: 9, status: "success", name: "UC-09: Progress Tracking", existing: "No", action: "Create" },
    { id: 10, status: "success", name: "UC-10: Report Generation", existing: "No", action: "Create" },
  ];

  const readyCount = mockDocuments.filter(d => d.status === "success").length;
  const conflictCount = mockDocuments.filter(d => d.status === "warning").length;
  const errorCount = mockDocuments.filter(d => d.status === "error").length;

  return (
    <Container>
      <SplitLayout>
        <LeftPanel>
          <ConfigSection>
            <SectionTitle>{t("Configuration")}</SectionTitle>

            <OptionGroup>
              <Label>{t("Target Folder")}</Label>
              <Select>
                <option>📁 /SRS/Use Cases</option>
              </Select>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("Parse Mode")}</Label>
              <RadioGroup>
                <RadioOption>
                  <input type="radio" name="parseMode" defaultChecked={false} />
                  <span>{t("Single Document")}</span>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="parseMode" defaultChecked={true} />
                  <span>{t("Multiple Use Cases")}</span>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="parseMode" defaultChecked={false} />
                  <span>{t("Auto-detect")}</span>
                </RadioOption>
              </RadioGroup>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("On Duplicate")}</Label>
              <RadioGroup>
                <RadioOption>
                  <input type="radio" name="conflict" defaultChecked={false} />
                  <span>{t("Skip")}</span>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="conflict" defaultChecked={true} />
                  <span>{t("Replace")}</span>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="conflict" defaultChecked={false} />
                  <span>{t("Create copy")}</span>
                </RadioOption>
              </RadioGroup>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("Assign to Actor")}</Label>
              <Select>
                <option>BA</option>
                <option>Developer</option>
                <option>QA</option>
              </Select>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("Tags")}</Label>
              <TagContainer>
                <TagInput placeholder={t("+ Add tag...")} />
                <Tag>LMS</Tag>
                <Tag>v2.0</Tag>
              </TagContainer>
            </OptionGroup>
          </ConfigSection>
        </LeftPanel>

        <RightPanel>
          <PreviewSection>
            <PreviewHeader>
              <HeaderTop>
                <PreviewTitle>{t("Detected Content")}</PreviewTitle>
                <StatusBadge>
                  <StatusIcon>
                    <BootstrapIcon name="check" size={14} />
                  </StatusIcon>
                  {readyCount} items ready
                </StatusBadge>
              </HeaderTop>
              <HeaderSub>
                {t("Successfully parsed")} {readyCount + conflictCount + errorCount} {t("items from document")}
              </HeaderSub>
            </PreviewHeader>

            <TableContainer>
              <Table>
                <thead>
                  <TableHeaderRow>
                    <TableHeaderCell $width="44px">
                      <StyledCheckbox
                        type="checkbox"
                        defaultChecked={true}
                        onChange={(e) => {
                          setSelectedRows(Array(mockDocuments.length).fill(e.target.checked));
                        }}
                      />
                    </TableHeaderCell>
                    <TableHeaderCell>{t("Status")}</TableHeaderCell>
                    <TableHeaderCell $grow>{t("Name")}</TableHeaderCell>
                    <TableHeaderCell>{t("Existing?")}</TableHeaderCell>
                    <TableHeaderCell>{t("Action")}</TableHeaderCell>
                  </TableHeaderRow>
                </thead>
                <tbody>
                  {mockDocuments.map((doc, idx) => (
                    <TableBodyRow key={doc.id}>
                      <TableCell $width="44px">
                        <StyledCheckbox
                          type="checkbox"
                          defaultChecked={selectedRows[idx]}
                          onChange={(e) => {
                            const newSelected = [...selectedRows];
                            newSelected[idx] = e.target.checked;
                            setSelectedRows(newSelected);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusIcon $type={doc.status}>
                          {doc.status === "success" ? (
                            <BootstrapIcon name="check" size={14} />
                          ) : doc.status === "warning" ? (
                            <BootstrapIcon name="exclamation-circle" size={14} />
                          ) : (
                            <BootstrapIcon name="x-circle" size={14} />
                          )}
                        </StatusIcon>
                      </TableCell>
                      <TableCell $grow>{doc.name}</TableCell>
                      <TableCell>{doc.existing}</TableCell>
                      <TableCell>
                        <ActionBadge $action={doc.action}>
                          {doc.action}
                        </ActionBadge>
                      </TableCell>
                    </TableBodyRow>
                  ))}
                </tbody>
              </Table>
            </TableContainer>

            <SummaryBar>
              <SummaryItem>
                <SummaryLabel>{readyCount}</SummaryLabel>
                <SummaryValue>{t("to import")}</SummaryValue>
              </SummaryItem>
              <Divider />
              <SummaryItem>
                <SummaryLabel>{conflictCount}</SummaryLabel>
                <SummaryValue>{t("to replace")}</SummaryValue>
              </SummaryItem>
              <Divider />
              <SummaryItem>
                <SummaryLabel>{errorCount}</SummaryLabel>
                <SummaryValue>{t("to skip")}</SummaryValue>
              </SummaryItem>
            </SummaryBar>
          </PreviewSection>
        </RightPanel>
      </SplitLayout>
    </Container>
  );
});

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const SplitLayout = styled.div`
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 24px;

  @media (max-width: 1200px) {
    grid-template-columns: 280px 1fr;
  }

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const LeftPanel = styled.div`
  display: flex;
  flex-direction: column;
`;

const RightPanel = styled.div`
  display: flex;
  flex-direction: column;
`;

const ConfigSection = styled.div`
  background: linear-gradient(135deg, #FFFFFF 0%, #F9FAFB 100%);
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #E5E7EB;
`;

const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

const Label = styled.label`
  font-weight: 600;
  font-size: 13px;
  color: #111827;
`;

const Select = styled.select`
  padding: 8px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  font-size: 13px;
  background: white;
  color: #111827;
  cursor: pointer;
  transition: all 150ms ease-in-out;

  &:hover {
    border-color: #3B82F6;
    background: #F9FAFB;
  }

  &:focus {
    outline: none;
    border-color: #3B82F6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

const RadioGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RadioOption = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  transition: all 150ms ease-in-out;

  input[type="radio"] {
    cursor: pointer;
    accent-color: #3B82F6;
  }

  &:hover {
    color: #111827;
  }
`;

const TagContainer = styled(Flex)`
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
`;

const TagInput = styled.input`
  flex: 1;
  min-width: 80px;
  padding: 6px 10px;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-size: 12px;
  background: white;
  transition: all 150ms ease-in-out;

  &::placeholder {
    color: #D1D5DB;
  }

  &:focus {
    outline: none;
    border-color: #3B82F6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

const Tag = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
  color: #2563EB;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
`;

const PreviewSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PreviewHeader = styled.div`
  background: linear-gradient(135deg, #FFFFFF 0%, #F9FAFB 100%);
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03);
`;

const HeaderTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const PreviewTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #111827;
`;

const StatusBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%);
  border: 1px solid #BBEF63;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #10B981;
`;

const HeaderSub = styled.div`
  font-size: 13px;
  color: #9CA3AF;
`;

const TableContainer = styled.div`
  background: linear-gradient(135deg, #FFFFFF 0%, #F9FAFB 100%);
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03);
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const TableHeaderRow = styled.tr`
  background: linear-gradient(90deg, #F3F4F6 0%, #F9FAFB 100%);
  border-bottom: 1px solid #E5E7EB;
`;

type TableCellProps = {
  $width?: string;
  $grow?: boolean;
};

const TableHeaderCell = styled.th<TableCellProps>`
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: #6B7280;
  width: ${(props) => props.$width};
  flex: ${(props) => (props.$grow ? 1 : 0)};
  white-space: nowrap;
`;

const TableBodyRow = styled.tr`
  border-bottom: 1px solid #E5E7EB;
  transition: background-color 200ms ease-in-out;

  &:hover {
    background: linear-gradient(90deg, #F9FAFB 0%, #F3F4F6 100%);
  }

  &:last-child {
    border-bottom: none;
  }
`;

const TableCell = styled.td<TableCellProps>`
  padding: 14px 16px;
  color: #111827;
  width: ${(props) => props.$width};
  flex: ${(props) => (props.$grow ? 1 : 0)};

  input[type="checkbox"] {
    cursor: pointer;
  }
`;

const StyledCheckbox = styled.input`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #3B82F6;
`;

type StatusIconProps = {
  $type?: string;
};

const StatusIcon = styled.span<StatusIconProps>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: ${(props) => {
    switch (props.$type) {
      case "success":
        return "#ECFDF5";
      case "warning":
        return "#FFFBEB";
      case "error":
        return "#FEF2F2";
      default:
        return "#F3F4F6";
    }
  }};
  color: ${(props) => {
    switch (props.$type) {
      case "success":
        return "#10B981";
      case "warning":
        return "#D97706";
      case "error":
        return "#EF4444";
      default:
        return "#9CA3AF";
    }
  }};
`;

type ActionBadgeProps = {
  $action: string;
};

const ActionBadge = styled.span<ActionBadgeProps>`
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background: ${(props) => {
    switch (props.$action) {
      case "Create":
        return "#ECFDF5";
      case "Replace":
        return "#FFFBEB";
      case "Skip":
        return "#F3F4F6";
      default:
        return "#F3F4F6";
    }
  }};
  color: ${(props) => {
    switch (props.$action) {
      case "Create":
        return "#10B981";
      case "Replace":
        return "#D97706";
      case "Skip":
        return "#9CA3AF";
      default:
        return "#6B7280";
    }
  }};
  border: 1px solid ${(props) => {
    switch (props.$action) {
      case "Create":
        return "#BBEF63";
      case "Replace":
        return "#FCD34D";
      case "Skip":
        return "#E5E7EB";
      default:
        return "#E5E7EB";
    }
  }};
`;

const SummaryBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  background: linear-gradient(135deg, #FFFFFF 0%, #F9FAFB 100%);
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03);
`;

const SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 4px;
`;

const SummaryLabel = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: #3B82F6;
`;

const SummaryValue = styled.div`
  font-size: 12px;
  color: #6B7280;
  font-weight: 500;
`;

const Divider = styled.div`
  width: 1px;
  height: 32px;
  background: #E5E7EB;
`;

export default PreviewMapping;
