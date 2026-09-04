/*
  Warnings:

  - You are about to drop the `rag_chunks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rag_documents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "rag_chunks" DROP CONSTRAINT "rag_chunks_documentId_fkey";

-- DropTable
DROP TABLE "rag_chunks";

-- DropTable
DROP TABLE "rag_documents";
