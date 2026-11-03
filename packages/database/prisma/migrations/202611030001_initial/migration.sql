-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 0,
    `googleRefresh` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Form` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `sourceUrl` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Form_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormSchema` (
    `id` CHAR(36) NOT NULL,
    `formId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `definition` JSON NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FormSchema_formId_version_key`(`formId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormQuestion` (
    `id` CHAR(36) NOT NULL,
    `schemaId` CHAR(36) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `required` BOOLEAN NOT NULL,
    `metadata` JSON NOT NULL,

    UNIQUE INDEX `FormQuestion_schemaId_externalId_key`(`schemaId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExcelTemplate` (
    `id` CHAR(36) NOT NULL,
    `schemaId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Upload` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `templateId` CHAR(36) NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `total` INTEGER NOT NULL,
    `valid` INTEGER NOT NULL,
    `invalid` INTEGER NOT NULL,
    `encryptedData` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Upload_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `Upload_userId_checksum_templateId_key`(`userId`, `checksum`, `templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionJob` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `uploadId` CHAR(36) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
    `reason` TEXT NULL,
    `authorizedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubmissionJob_uploadId_key`(`uploadId`),
    INDEX `SubmissionJob_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `SubmissionJob_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionRecord` (
    `id` CHAR(36) NOT NULL,
    `jobId` CHAR(36) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `encryptedAnswers` LONGTEXT NOT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `submitIntentAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubmissionRecord_jobId_status_idx`(`jobId`, `status`),
    UNIQUE INDEX `SubmissionRecord_jobId_rowNumber_key`(`jobId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionAttempt` (
    `id` CHAR(36) NOT NULL,
    `recordId` CHAR(36) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `status` VARCHAR(40) NOT NULL,
    `error` TEXT NULL,

    INDEX `SubmissionAttempt_recordId_startedAt_idx`(`recordId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Form` ADD CONSTRAINT `Form_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormSchema` ADD CONSTRAINT `FormSchema_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormQuestion` ADD CONSTRAINT `FormQuestion_schemaId_fkey` FOREIGN KEY (`schemaId`) REFERENCES `FormSchema`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExcelTemplate` ADD CONSTRAINT `ExcelTemplate_schemaId_fkey` FOREIGN KEY (`schemaId`) REFERENCES `FormSchema`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Upload` ADD CONSTRAINT `Upload_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Upload` ADD CONSTRAINT `Upload_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ExcelTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionJob` ADD CONSTRAINT `SubmissionJob_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionJob` ADD CONSTRAINT `SubmissionJob_uploadId_fkey` FOREIGN KEY (`uploadId`) REFERENCES `Upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionRecord` ADD CONSTRAINT `SubmissionRecord_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `SubmissionJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionAttempt` ADD CONSTRAINT `SubmissionAttempt_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `SubmissionRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
