import "./bootstrap";
import { KanbanBoard, KanbanList, KanbanCard } from "../models";

async function clearKanbanData() {
  console.log("Clearing all Kanban data...");

  // Delete in order due to foreign keys
  const cardsDeleted = await KanbanCard.destroy({ where: {}, force: true });
  console.log(`Deleted ${cardsDeleted} cards`);

  const listsDeleted = await KanbanList.destroy({ where: {}, force: true });
  console.log(`Deleted ${listsDeleted} lists`);

  const boardsDeleted = await KanbanBoard.destroy({ where: {}, force: true });
  console.log(`Deleted ${boardsDeleted} boards`);

  console.log("Done! You can now create a new board with proper indexes.");
  process.exit(0);
}

clearKanbanData().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
