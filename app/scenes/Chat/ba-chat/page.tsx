'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatConversation } from './components/ChatConversation';
import type { Conversation, Message, QuickAction } from './types';
import { createConversation, fetchConversations, fetchMessages, renameConversation, sendMessage, deleteConversation, ClaudeApiError } from '~/scenes/DocumentToGraph/lib/api';
import ClaudeCredentialModal from '~/scenes/ClaudeCredentialModal';
import { toDisplayMessage, toDisplayConversation } from "./helper";
import useStores from '~/hooks/useStores';


function BAChatPage() {
  const { auth, ui, dialogs } = useStores();
  const userId = auth.currentUserId ?? "";
  const workspaceId = auth.currentTeamId ?? "";

  // conversations: Danh sách conversations hiển thị ở sidebar
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // activeConversationId: ID của conversation đang được xem
  // null = chưa có conversation nào (app vừa load, DB rỗng)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // conversationMessages: Map từ conversationId → danh sách messages
  // Lazy load: chỉ fetch khi user click vào conversation
  const [conversationMessages, setConversationMessages] = useState<Record<string, Message[]>>({});

  const [typingConversationIds, setTypingConversationIds] = useState<Set<string>>(new Set());

  const messages = activeConversationId
    ? (conversationMessages[activeConversationId] ?? [])
    : [];

  const chatTitle = conversations.find((c) => c.id === activeConversationId)?.title
    ?? 'BA Agent Chat';


  // ─────────────────────────────────────────────────────────
  // HANDLER: Xóa conversation
  // ─────────────────────────────────────────────────────────
  const handleDeleteConversation = async (id: string) => {
    // BƯỚC 1: Lưu lại state cũ để rollback nếu API fail
    const previousConversations = conversations;

    // BƯỚC 2: Xác định conversation còn lại sau khi xóa
    const remainingConvs = conversations.filter((c) => c.id !== id);

    // BƯỚC 3: Xác định conversation đang active có bị xóa không
    const isActiveBeingDeleted = activeConversationId === id;

    // BƯỚC 4: OPTIMISTIC UPDATE — xóa UI ngay lập tức (không chờ API)
    setConversations(remainingConvs);

    // BƯỚC 5: Nếu đang xóa conversation active → chuyển sang cái khác
    if (isActiveBeingDeleted) {
      if (remainingConvs.length > 0) {
        // Còn conversation khác → chuyển sang cái đầu tiên còn lại
        const nextConv = remainingConvs[0];
        setActiveConversationId(nextConv.id);
        setConversations(remainingConvs.map((c, i) => ({ ...c, isActive: i === 0 })));
        // Load messages nếu chưa có trong state
        if (!conversationMessages[nextConv.id]) {
          await loadMessages(nextConv.id);
        }
      } else {
        // Không còn conversation nào → reset về trống
        setActiveConversationId(null);
      }
    }

    // BƯỚC 6: Xóa messages của conversation bị xóa khỏi state (giải phóng memory)
    setConversationMessages((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });

    try {
      // BƯỚC 7: Gọi API — xóa trong DB
      await deleteConversation(id, workspaceId);
      // Optimistic update đã xong → không cần cập nhật thêm
    } catch {
      // BƯỚC 8: ROLLBACK — API thất bại → khôi phục state cũ
      setConversations(previousConversations);
      if (isActiveBeingDeleted) {
        setActiveConversationId(id);
      }
    }
  };

  // ─────────────────────────────────────────────────────────
  // HELPER: Load messages của một conversation vào state
  // ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await fetchMessages(conversationId, userId, workspaceId);

      const displayMessages = data.messages.map(toDisplayMessage);
      setConversationMessages((prev) => ({
        ...prev,
        [conversationId]: displayMessages,
      }));
    } catch {
      // ignore
    }
  }, [userId, workspaceId]);


  // ─────────────────────────────────────────────────────────
  // EFFECT: Load conversations khi component mount
  // ─────────────────────────────────────────────────────────
  // Chạy 1 lần duy nhất khi trang Chat được mở.
  // Load danh sách conversations từ DB, set conversation đầu tiên là active,
  // và load messages của conversation đó để hiển thị ngay.
  // ─────────────────────────────────────────────────────────
  // M3A.6: Cleanup — reset flag khi component unmount tránh stuck = true
  useEffect(() => () => { ui.setAIRequestPending(false); }, [ui]);

  useEffect(() => {
    fetchConversations(userId, workspaceId)
      .then((data) => {
        const convList = data.conversations.map((c, i) =>
          toDisplayConversation(c, i === 0)
        );
        setConversations(convList);

        // Nếu có conversations, chọn cái đầu tiên và load messages của nó
        if (convList.length > 0) {
          setActiveConversationId(convList[0].id);
          loadMessages(convList[0].id);
        }
      })
      .catch(() => {/* ignore */ });
  }, [loadMessages, userId, workspaceId]);


  // ─────────────────────────────────────────────────────────
  // HANDLER: Tạo conversation mới
  // ─────────────────────────────────────────────────────────
  const handleNewChat = async () => {
    try {
      // Gọi API tạo conversation trong DB
      const newConvRecord = await createConversation('New conversation', userId, workspaceId);

      const newConv = toDisplayConversation(newConvRecord, true);

      // Bỏ active trên các conversation cũ, thêm conversation mới vào đầu list
      setConversations((prev) => [
        newConv,
        ...prev.map((c) => ({ ...c, isActive: false })),
      ]);
      setConversationMessages((prev) => ({ ...prev, [newConv.id]: [] }));
      setActiveConversationId(newConv.id);
    } catch {
      // ignore
    }
  };


  // ─────────────────────────────────────────────────────────
  // HANDLER: Chuyển sang conversation khác
  // ─────────────────────────────────────────────────────────
  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    setConversations((prev) =>
      prev.map((c) => ({ ...c, isActive: c.id === id }))
    );

    // Lazy load: chỉ fetch messages nếu chưa có trong state
    // (tránh fetch lại mỗi lần click)
    if (!conversationMessages[id]) {
      await loadMessages(id);
    }
  };


  // ─────────────────────────────────────────────────────────
  // HANDLER: Gửi tin nhắn
  // ─────────────────────────────────────────────────────────
  const handleSendMessage = async (content: string) => {
    //if (!activeConversationId) return;
    let conversationId = activeConversationId;
    if (!conversationId) {
      // CASE B: DB rỗng — auto-create conversation rồi mới gửi message
      try {
        // Gọi API tạo conversation mới (giống handleNewChat)
        const newConvRecord = await createConversation('New conversation', userId, workspaceId);

        // Convert từ backend record → frontend display format
        const newConv = toDisplayConversation(newConvRecord, true);

        // Cập nhật state:
        // - Thêm conversation mới vào danh sách (thay thế list rỗng)
        // - Khởi tạo messages array rỗng cho conversation này
        // - Set conversation mới là active
        setConversations([newConv]);
        setConversationMessages((prev) => ({ ...prev, [newConv.id]: [] }));
        setActiveConversationId(newConv.id);

        // Lưu id vào local var để dùng cho các bước bên dưới
        conversationId = newConv.id;
      } catch {
        // Nếu tạo conversation thất bại → không thể gửi message, dừng lại
        return;
      }
    }

    // OPTIMISTIC UPDATE: Hiển thị user message ngay lập tức (không chờ API)
    // Dùng temp ID — chỉ cho display, ID thực từ DB sẽ được dùng khi load lại
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    setConversationMessages((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] ?? []), tempUserMessage],
    }));

    setTypingConversationIds(prev => new Set(prev).add(conversationId));
    ui.setAIRequestPending(true); // M3A: disable credential save khi AI đang xử lý

    try {
      // Gọi API: lưu message vào DB và nhận AI response
      const data = await sendMessage(conversationId, content, userId, workspaceId);

      // Thêm AI message vào UI (user message đã hiển thị từ optimistic update)
      const aiMessage = toDisplayMessage(data.ai_message);

      setConversationMessages((prev) => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] ?? []), aiMessage],
      }));

      // Cập nhật preview của conversation trong sidebar
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, preview: content.substring(0, 60) }
            : c
        )
      );

    } catch (err) {
      if (
        err instanceof ClaudeApiError &&
        (err.errorCode === "CLAUDE_CREDENTIAL_MISSING" ||
          err.errorCode === "CLAUDE_CREDENTIAL_EXPIRED")
      ) {
        // M4: Credential missing/expired → mở modal để user reconnect
        dialogs.openModal({
          title: "Claude Connection",
          content: (
            <ClaudeCredentialModal
              onClose={dialogs.closeAllModals}
              initialError={
                err.errorCode === "CLAUDE_CREDENTIAL_EXPIRED"
                  ? "Credentials đã hết hạn, vui lòng kết nối lại."
                  : "Bạn chưa kết nối tài khoản Claude."
              }
            />
          ),
        });
      } else {
        // Lỗi khác (CLIPROXY_UNAVAILABLE, network, v.v.) → hiển thị inline
        const content =
          err instanceof ClaudeApiError
            ? "Claude AI tạm thời không khả dụng. Vui lòng thử lại sau."
            : "Sorry, I encountered an error. Please try again.";
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          content,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        };
        setConversationMessages((prev) => ({
          ...prev,
          [conversationId]: [...(prev[conversationId] ?? []), errorMessage],
        }));
      }
    } finally {
      setTypingConversationIds(prev => { const s = new Set(prev); s.delete(conversationId); return s; });
      ui.setAIRequestPending(false); // M3A: reset sau khi AI trả về (success hoặc error)
    }
  };

  // ─────────────────────────────────────────────────────────
  // HANDLER: Đổi tên conversation
  // ─────────────────────────────────────────────────────────
  const handleRenameConversation = async (id: string, newTitle: string) => {
    // GUARD: Không làm gì nếu tên rỗng sau khi trim
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) { return; }

    // OPTIMISTIC UPDATE: Cập nhật UI ngay lập tức (không chờ API)
    // → User thấy tên mới ngay, trải nghiệm mượt hơn
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmedTitle } : c))
    );

    try {
      // GỌI API: Lưu tên mới vào DB
      await renameConversation(id, trimmedTitle, workspaceId);
      // Không cần cập nhật state thêm vì optimistic update đã làm rồi
    } catch {
      // ROLLBACK: Nếu API thất bại, khôi phục tên cũ
      // → Fetch lại danh sách từ DB để đảm bảo state đồng bộ
      fetchConversations(userId, workspaceId)
        .then((data) => {
          const convList = data.conversations.map((c) =>
            toDisplayConversation(c, c.id === activeConversationId)
          );
          setConversations(convList);
        })
        .catch(() => {/* Bỏ qua lỗi fetch khi rollback */ });
    }
  };

  const quickActions: QuickAction[] = [

    {
      id: '2',
      icon: 'sparkles',
      title: 'Ask questions about documents',
      description: 'Answer questions related to the content of uploaded documents',
      onClick: () => { },
    },
    {
      id: '4',
      icon: 'file',
      title: 'Edit current document',
      description: 'Modify the content of uploaded documents to update the latest information in kanban board',
      onClick: () => { },
    },
  ];


  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div className="absolute inset-0 flex overflow-hidden bg-white dark:bg-[#111319]">
        <ChatConversation
          messages={messages}
          quickActions={quickActions}
          onSendMessage={handleSendMessage}
          isTyping={typingConversationIds.has(activeConversationId ?? '')}
          chatTitle={chatTitle}
          conversations={conversations}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>
    </div>
  );
}

export default BAChatPage;
