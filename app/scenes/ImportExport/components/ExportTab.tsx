import { observer } from "mobx-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { BootstrapIcon } from "./BootstrapIcon";

const ExportTab = observer(() => {
  const { t } = useTranslation();
  const [selectedDocuments, setSelectedDocuments] = useState<number[]>([1, 2, 4]);
  const [searchQuery, setSearchQuery] = useState("");

  const mockDocuments = [
    { id: 1, name: "UC-01: Login System", folder: "/SRS/Use Cases" },
    { id: 2, name: "UC-02: Document Management", folder: "/SRS/Use Cases" },
    { id: 3, name: "UC-03: Search Function", folder: "/SRS/Use Cases" },
    { id: 4, name: "UC-04: Export Feature", folder: "/SRS/Use Cases" },
    { id: 5, name: "Overview", folder: "/SRS" },
    { id: 6, name: "Actors List", folder: "/SRS" },
  ];

  const toggleDocument = (id: number) => {
    setSelectedDocuments((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  return (
    <Container>
      <SplitLayout>
        <LeftSection>
          <SectionCard>
            <SectionTitle>{t("Select Documents")}</SectionTitle>

            <SearchBox>
              <SearchIcon>
                <BootstrapIcon name="search" size={16} />
              </SearchIcon>
              <SearchInput
                placeholder={t("Search documents...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </SearchBox>

            <QuickSelectButtons>
              <QuickSelectBtn
                onClick={() => setSelectedDocuments(mockDocuments.map(d => d.id))}
              >
                {t("All Documents")}
              </QuickSelectBtn>
              <QuickSelectBtn>
                {t("Current Folder")}
              </QuickSelectBtn>
            </QuickSelectButtons>

            <DocumentListWrapper>
              <DocumentList>
                {mockDocuments.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    onClick={() => toggleDocument(doc.id)}
                    $selected={selectedDocuments.includes(doc.id)}
                  >
                    <DocumentCheckbox
                      type="checkbox"
                      checked={selectedDocuments.includes(doc.id)}
                      onChange={() => { }}
                    />
                    <DocumentIcon>
                      <BootstrapIcon name="file-text" size={18} />
                    </DocumentIcon>
                    <DocumentInfo>
                      <DocumentName>{doc.name}</DocumentName>
                      <DocumentPath>{doc.folder}</DocumentPath>
                    </DocumentInfo>
                  </DocumentItem>
                ))}
              </DocumentList>
            </DocumentListWrapper>

            <SelectionInfoBar>
              <SelectionCount>
                <CountBadge>{selectedDocuments.length}</CountBadge>
                {t("documents selected")}
              </SelectionCount>
              <SelectionButtonsGroup>
                <SmallBtn
                  onClick={() => setSelectedDocuments(mockDocuments.map(d => d.id))}
                >
                  {t("All")}
                </SmallBtn>
                <SmallBtn onClick={() => setSelectedDocuments([])}>
                  {t("Clear")}
                </SmallBtn>
              </SelectionButtonsGroup>
            </SelectionInfoBar>
          </SectionCard>
        </LeftSection>

        <RightSection>
          <SectionCard>
            <SectionTitle>{t("Export Options")}</SectionTitle>

            <OptionGroup>
              <Label>{t("Export Format")}</Label>
              <RadioGroup>
                <RadioOption>
                  <input type="radio" name="format" defaultChecked={false} />
                  <RadioLabel>
                    <BootstrapIcon name="file-pdf" size={14} style={{ marginRight: "6px" }} />
                    {t("DOCX")}
                  </RadioLabel>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="format" defaultChecked={true} />
                  <RadioLabel>📑 {t("PDF")}</RadioLabel>
                </RadioOption>
              </RadioGroup>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("Export Mode")}</Label>
              <RadioGroup>
                <RadioOption>
                  <input type="radio" name="mode" defaultChecked={true} />
                  <RadioLabel>{t("Single File")}</RadioLabel>
                </RadioOption>
                <RadioOption>
                  <input type="radio" name="mode" defaultChecked={false} />
                  <RadioLabel>{t("Multiple Files (ZIP)")}</RadioLabel>
                </RadioOption>
              </RadioGroup>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("Include in Export")}</Label>
              <CheckboxGroup>
                <CheckboxOption>
                  <input type="checkbox" defaultChecked={true} />
                  <span>{t("Metadata")}</span>
                </CheckboxOption>
                <CheckboxOption>
                  <input type="checkbox" defaultChecked={true} />
                  <span>{t("Table of Contents")}</span>
                </CheckboxOption>
                <CheckboxOption>
                  <input type="checkbox" defaultChecked={false} />
                  <span>{t("Comments")}</span>
                </CheckboxOption>
                <CheckboxOption>
                  <input type="checkbox" defaultChecked={true} />
                  <span>{t("Page Numbers")}</span>
                </CheckboxOption>
              </CheckboxGroup>
            </OptionGroup>

            <OptionGroup>
              <Label>{t("File Name")}</Label>
              <FileNameInputWrapper>
                <FileNameInput
                  placeholder="Export_2024"
                  defaultValue="Export_2024"
                />
                <FileExtension>.pdf</FileExtension>
              </FileNameInputWrapper>
            </OptionGroup>
          </SectionCard>
        </RightSection>
      </SplitLayout>

      <ActionBar>
        <CancelBtn>{t("Cancel")}</CancelBtn>
        <DownloadBtn>
          <DownloadIcon>
            <BootstrapIcon name="download" size={16} />
          </DownloadIcon>
          {t("Download")}
        </DownloadBtn>
      </ActionBar>
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
  grid-template-columns: 1fr 1fr;
  gap: 24px;

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
  }
`;

const LeftSection = styled.div`
  display: flex;
  flex-direction: column;
`;

const RightSection = styled.div`
  display: flex;
  flex-direction: column;
`;

const SectionCard = styled.div`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  padding: 20px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)"};
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const SectionTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${s("text")};
  padding-bottom: 12px;
  border-bottom: 1px solid ${s("divider")};
`;

const SearchBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const SearchIcon = styled.span`
  position: absolute;
  left: 12px;
  font-size: 14px;
  color: ${s("textTertiary")};
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  font-size: 13px;
  background: ${s("background")};
  color: ${s("text")};
  transition: all 200ms ease-in-out;

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:focus {
    outline: none;
    border-color: ${s("inputBorderFocused")};
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

const QuickSelectButtons = styled.div`
  display: flex;
  gap: 6px;
`;

const QuickSelectBtn = styled.button`
  flex: 1;
  padding: 8px 12px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  background: ${s("buttonNeutralBackground")};
  color: ${s("buttonNeutralText")};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease-in-out;

  &:hover {
    background: ${s("listItemHoverBackground")};
    border-color: #3B82F6;
    color: #3B82F6;
  }
`;

const DocumentListWrapper = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
  background: ${s("background")};
`;

const DocumentList = styled.div`
  max-height: 360px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: ${s("scrollbarBackground")};
  }

  &::-webkit-scrollbar-thumb {
    background: ${s("scrollbarThumb")};
    border-radius: 3px;

    &:hover {
      background: ${s("textTertiary")};
    }
  }
`;

type DocumentItemProps = {
  $selected: boolean;
};

const DocumentItem = styled.div<DocumentItemProps>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid ${(props) =>
    props.theme.isDark ? props.theme.backgroundSecondary : "#F3F4F6"};
  cursor: pointer;
  transition: all 150ms ease-in-out;
  background: ${(props) =>
    props.$selected
      ? props.theme.isDark
        ? "rgba(59, 130, 246, 0.15)"
        : "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)"
      : props.theme.background};
  border-left: 3px solid
    ${(props) => (props.$selected ? "#3B82F6" : "transparent")};

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${(props) =>
    props.$selected
      ? props.theme.isDark
        ? "rgba(59, 130, 246, 0.15)"
        : "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)"
      : props.theme.listItemHoverBackground};
  }
`;

const DocumentCheckbox = styled.input`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #3B82F6;
  flex-shrink: 0;
`;

const DocumentIcon = styled.div`
  font-size: 16px;
  flex-shrink: 0;
`;

const DocumentInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

const DocumentName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
  word-break: break-word;
`;

const DocumentPath = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const SelectionInfoBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: ${(props) =>
    props.theme.isDark
      ? "rgba(16, 185, 129, 0.1)"
      : "linear-gradient(135deg, #ECFDF5 0%, #F0FDF4 100%)"};
  border: 1px solid ${(props) =>
    props.theme.isDark ? "rgba(16, 185, 129, 0.3)" : "#BBF7D0"};
  border-radius: 8px;
  gap: 12px;
`;

const SelectionCount = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #10B981;
`;

const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: #10B981;
  color: white;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
`;

const SelectionButtonsGroup = styled.div`
  display: flex;
  gap: 6px;
`;

const SmallBtn = styled.button`
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: ${(props) =>
    props.theme.isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(255, 255, 255, 0.6)"};
  color: #10B981;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease-in-out;

  &:hover {
    background: ${(props) =>
      props.theme.isDark ? "rgba(255, 255, 255, 0.15)" : "white"};
    border-color: #10B981;
  }
`;

const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  font-weight: 700;
  font-size: 13px;
  color: ${s("text")};
`;

const RadioGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RadioOption = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: all 150ms ease-in-out;

  input[type="radio"] {
    cursor: pointer;
    accent-color: #3B82F6;
    width: 16px;
    height: 16px;
  }

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const RadioLabel = styled.span`
  font-size: 13px;
  color: ${s("textSecondary")};
  font-weight: 500;
`;

const CheckboxGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CheckboxOption = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: all 150ms ease-in-out;
  font-size: 13px;
  color: ${s("textSecondary")};

  input[type="checkbox"] {
    cursor: pointer;
    accent-color: #3B82F6;
    width: 16px;
    height: 16px;
  }

  &:hover {
    background: ${s("listItemHoverBackground")};
  }
`;

const FileNameInputWrapper = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
`;

const FileNameInput = styled.input`
  flex: 1;
  padding: 8px 12px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  font-size: 13px;
  background: ${s("background")};
  color: ${s("text")};
  transition: all 150ms ease-in-out;

  &::placeholder {
    color: ${s("placeholder")};
  }

  &:focus {
    outline: none;
    border-color: ${s("inputBorderFocused")};
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
`;

const FileExtension = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${s("textTertiary")};
  white-space: nowrap;
`;

const ActionBar = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 12px;
  box-shadow: ${(props) =>
    props.theme.isDark
      ? "0 1px 3px rgba(0, 0, 0, 0.2)"
      : "0 1px 3px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)"};
`;

const CancelBtn = styled.button`
  padding: 10px 20px;
  background: transparent;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  color: ${s("textTertiary")};
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;

  &:hover {
    background: ${s("listItemHoverBackground")};
    border-color: ${s("inputBorder")};
    color: ${s("textSecondary")};
  }

  &:active {
    background: ${s("backgroundSecondary")};
  }
`;

const DownloadBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 200ms ease-in-out;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);

  &:hover {
    background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(59, 130, 246, 0.4);
  }

  &:active {
    transform: translateY(0);
  }
`;

const DownloadIcon = styled.span`
  font-size: 16px;
`;

export default ExportTab;
