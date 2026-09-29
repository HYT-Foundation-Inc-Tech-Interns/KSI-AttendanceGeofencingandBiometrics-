import { apiClient } from './apiClient';

/**
 * Shape returned by `GET /employees/:id`.
 *
 * NOTE: the shared `Employee` type in `@/types/api.types` is snake_case, but the
 * backend serialises the TypeORM entity directly, so the wire format is
 * camelCase. This interface reflects what actually comes back.
 */
export interface EmployeeWithSite {
  id: string;
  organizationId: string;
  siteId: string | null;
  employeeCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  site: {
    id: string;
    name: string;
    address: string | null;
    timezone: string;
    status: string;
  } | null;
}

export const employeesApi = {
  /**
   * Get employee by ID. The response includes the `site` relation and `siteId`,
   * which is how the app discovers the site the signed-in employee belongs to.
   */
  getById: async (employeeId: string): Promise<EmployeeWithSite> => {
    return apiClient.get<EmployeeWithSite>(`/employees/${employeeId}`);
  },
};
