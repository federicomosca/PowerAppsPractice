﻿using FM.PAP.CLIENTACTION;
using FM.PAP.LESSON;
using FM.PAP.UTILS;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.ServiceModel;
using System.Text;
using System.Threading.Tasks;

namespace FM.PAP.ATTENDANCE
{
    public class PostDelete : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            ITracingService tracingService =
            (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            IPluginExecutionContext context = (IPluginExecutionContext)
            serviceProvider.GetService(typeof(IPluginExecutionContext));

            if (context.PreEntityImages.Contains("PreImage") &&
                context.PreEntityImages["PreImage"] is Entity preImage)
            {
                IOrganizationServiceFactory serviceFactory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
                IOrganizationService service = serviceFactory.CreateOrganizationService(context.UserId);
                try
                {
                    if (preImage.Contains("res_classroombooking") && preImage["res_classroombooking"] is EntityReference erLesson)
                    {
                        Entity lesson = service.Retrieve("res_classroombooking", erLesson.Id, new ColumnSet("res_code", "res_classroomid"));

                        EntityReference erClassroom = lesson.Contains("res_classroomid") ? lesson.GetAttributeValue<EntityReference>("res_classroomid") : null;
                        Entity classroom = erClassroom != null ? service.Retrieve("res_classroom", erClassroom.Id, new ColumnSet("res_seats")) : null;

                        bool isInPerson = preImage.GetAttributeValue<bool>("res_participationmode");

                        #region AGGIORNO NELLA LEZIONE IL NUMERO DI POSTI DISPONIBILI E PARTECIPANTI

                        int classroomSeats = classroom?.GetAttributeValue<int?>("res_seats") ?? 0;

                        var fetchAttendancesCount = $@"<?xml version=""1.0"" encoding=""utf-16""?>
                                                <fetch returntotalrecordcount=""true"">
                                                  <entity name=""res_attendance"">
                                                    <attribute name=""res_participationmode"" />
                                                    <filter>
                                                      <condition attribute=""statecode"" operator=""eq"" value=""0"" />
                                                      <condition attribute=""res_classroombooking"" operator=""eq"" value=""{erLesson.Id}"" />
                                                    </filter>
                                                  </entity>
                                                </fetch>";

                        EntityCollection attendances = service.RetrieveMultiple(new FetchExpression(fetchAttendancesCount));

                        int inPersonAttendancesCount = attendances.Entities.Count(attendance => attendance.GetAttributeValue<bool>("res_participationmode") == true);
                        int remoteAttendancesCount = attendances.Entities.Count(attendance => attendance.GetAttributeValue<bool>("res_participationmode") == false);

                        lesson["res_attendees"] = inPersonAttendancesCount + remoteAttendancesCount;
                        lesson["res_remoteattendees"] = remoteAttendancesCount;
                        lesson["res_takenseats"] = inPersonAttendancesCount;
                        lesson["res_availableseats"] = classroomSeats - inPersonAttendancesCount;

                        if (isInPerson)
                        {
                            if (inPersonAttendancesCount < classroomSeats)
                            {

                                /**
                                 * CHIAMATA ALLA CUSTOM API CHE TORNA ERRORE: 0x80040265
                                 */

                                //var request = new OrganizationRequest("NOTIFICATE_LESSON_OPENING");

                                //request["jsonDataInput"] = JsonConvert.SerializeObject(erLesson.Id);

                                //try
                                //{
                                //    OrganizationResponse response = service.Execute(request);
                                //    tracingService.Trace("after calling client action");
                                //    if (response.Results.Contains("jsonDataOutput"))
                                //    {
                                //        tracingService.Trace("response from client action");
                                //        var outputValue = response.Results["jsonDataOutput"];
                                //    }
                                //}
                                //catch (FaultException<OrganizationServiceFault> ex)
                                //{
                                //    throw new InvalidPluginExecutionException($"Errore durante l'esecuzione dell'azione: {ex.Message}");
                                //}

                                /**
                                 * se cancello un record di un iscritto 'in-person' e si libera un posto
                                 * trasformo il mio primo record 'remote' in 'in-person' e gli mando una mail di notifica
                                 */
                                var fetchFirstRemoteAttendees = $@"<?xml version=""1.0"" encoding=""utf-16""?>
                                                                <fetch>
                                                                  <entity name=""res_attendance"">
                                                                    <attribute name=""res_attendanceid"" />
                                                                    <filter>
                                                                      <condition attribute=""statecode"" operator=""eq"" value=""0"" />
                                                                      <condition attribute=""res_classroombooking"" operator=""eq"" value=""{erLesson.Id}"" />
                                                                      <condition attribute=""res_participationmode"" operator=""eq"" value=""0"" />
                                                                    </filter>
                                                                    <order attribute=""createdon"" />
                                                                    <link-entity name=""res_subscriber"" from=""res_subscriberid"" to=""res_subscriberid"" alias=""linkedSubscriber"">
                                                                      <attribute name=""res_fullname"" />
                                                                      <attribute name=""res_emailaddress"" />
                                                                    </link-entity>
                                                                  </entity>
                                                                </fetch>";

                                EntityCollection results = service.RetrieveMultiple(new FetchExpression(fetchFirstRemoteAttendees));

                                if (results.Entities.Count() > 0)
                                {
                                    foreach (Entity firstRemoteAttendee in results.Entities)
                                    {
                                        string subscriberFullName = firstRemoteAttendee.GetAttributeValue<AliasedValue>("linkedSubscriber.res_fullname")?.Value as string;
                                        string subscriberEmail = firstRemoteAttendee.GetAttributeValue<AliasedValue>("linkedSubscriber.res_emailaddress")?.Value as string;
                                        string lessonCode = lesson.GetAttributeValue<string>("res_code") ?? string.Empty;

                                        string attendanceId = firstRemoteAttendee.GetAttributeValue<Guid>("res_attendanceid").ToString();

                                        var task = Task.Run(async () => await CallPowerAutomateFlow(tracingService, subscriberFullName, subscriberEmail, lessonCode, attendanceId));

                                        task.Wait();
                                    }
                                }
                                else
                                {
                                    tracingService.Trace("res_classroombooking non trovato nel preImage.");
                                }
                                #endregion
                            }
                        }
                    }
                }
                catch (FaultException<OrganizationServiceFault> ex)
                {
                    throw new InvalidPluginExecutionException("An error occurred in FollowUpPlugin.", ex);
                }
                catch (ApplicationException ex)
                {
                    tracingService.Trace("ApplicationException: {0}", ex.ToString());
                    throw new InvalidPluginExecutionException(ex.Message);
                }
                catch (Exception ex)
                {
                    tracingService.Trace("FollowUpPlugin: {0}", ex.ToString());
                    throw ex;
                }
            }
            else
            {
                tracingService.Trace("PreImage non trovato nel contesto.");
            }
        }

        private async Task CallPowerAutomateFlow(ITracingService tracingService, string subscriberFullName, string subscriberEmail, string lessonCode, string attendanceId)
        {
            string flowUrl = "https://prod-29.northeurope.logic.azure.com:443/workflows/6e131085e906484fa2d0dc74ea775786/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=-T1DGUsteF9r6Eok-ahXSP4ex-pNs6J5uMH145J7XzQ";

            try
            {
                using (HttpClient client = new HttpClient())
                {
                    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                    var data = new
                    {
                        subscriberFullName,
                        subscriberEmail,
                        lessonCode,
                        attendanceId
                    };
                    var json = JsonConvert.SerializeObject(data);
                    var content = new StringContent(json, Encoding.UTF8, "application/json");

                    tracingService.Trace("Sending request to Power Automate Flow URL: {0}", flowUrl);
                    HttpResponseMessage response = await client.PostAsync(flowUrl, content);
                    string responseContent = await response.Content.ReadAsStringAsync();

                    if (response.IsSuccessStatusCode)
                    {
                        tracingService.Trace("Power Automate Flow called successfully. Response: {0}", responseContent);
                    }
                    else
                    {
                        tracingService.Trace("Error calling Power Automate Flow. Status Code: {0}. Response: {1}", response.StatusCode, responseContent);
                    }
                }
            }
            catch (Exception ex)
            {
                tracingService.Trace("Exception occurred while calling Power Automate Flow: {0}", ex.ToString());
            }
        }

    }
}

