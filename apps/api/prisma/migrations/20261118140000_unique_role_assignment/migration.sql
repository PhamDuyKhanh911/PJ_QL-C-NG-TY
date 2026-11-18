CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_scopeType_scopeId_key"
ON "UserRoleAssignment"("userId", "roleId", "scopeType", "scopeId");
